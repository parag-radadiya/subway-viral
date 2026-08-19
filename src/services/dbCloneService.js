const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
const AppError = require('../utils/AppError');

// Collections that must never be copied (server-managed / internal).
const SYSTEM_COLLECTION_PREFIX = 'system.';

/**
 * Resolve the sandbox target: either a fully separate cluster (SANDBOX_MONGO_URI)
 * or a sibling database on the same cluster (SANDBOX_DB_NAME).
 *
 * Returns { client, db, dbName, ownsClient } where ownsClient indicates a
 * dedicated MongoClient that the caller is responsible for closing.
 */
const resolveSandboxTarget = async (sourceDbName) => {
  const sandboxUri = process.env.SANDBOX_MONGO_URI;

  if (sandboxUri) {
    const client = new MongoClient(sandboxUri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const db = client.db(); // db name taken from the URI path
    const dbName = db.databaseName;
    return { client, db, dbName, ownsClient: true };
  }

  // Same cluster, sibling database.
  const dbName =
    process.env.SANDBOX_DB_NAME && process.env.SANDBOX_DB_NAME.trim()
      ? process.env.SANDBOX_DB_NAME.trim()
      : `${sourceDbName}_sandbox`;

  const client = mongoose.connection.getClient();
  const db = client.db(dbName);
  return { client, db, dbName, ownsClient: false };
};

/**
 * Copy every non-system collection from the connected (production) database into
 * the sandbox database. The sandbox collections are dropped and rebuilt so the
 * result is an exact snapshot of production at clone time.
 *
 * SAFETY: refuses to run when the resolved target resolves to the production
 * database itself (same cluster + same db name).
 *
 * @returns {Promise<object>} summary of the clone
 */
const cloneProductionToSandbox = async ({ batchSize = 1000 } = {}) => {
  if (mongoose.connection.readyState !== 1) {
    throw new AppError('Database not connected; cannot clone', 503);
  }

  const sourceDb = mongoose.connection.db;
  const sourceDbName = sourceDb.databaseName;

  const target = await resolveSandboxTarget(sourceDbName);
  const { db: targetDb, dbName: targetDbName, ownsClient, client: targetClient } = target;

  try {
    // Guard: never let the sandbox resolve back onto production on the same cluster.
    const sameCluster = !ownsClient;
    if (sameCluster && targetDbName === sourceDbName) {
      throw new AppError(
        `Refusing to clone: sandbox database name matches production ("${sourceDbName}"). ` +
          'Set SANDBOX_DB_NAME (or SANDBOX_MONGO_URI) to a distinct target.',
        400
      );
    }

    const startedAt = new Date();
    const sourceCollections = (
      await sourceDb.listCollections({}, { nameOnly: false }).toArray()
    ).filter((c) => c.type === 'collection' && !c.name.startsWith(SYSTEM_COLLECTION_PREFIX));

    const results = [];

    for (const collInfo of sourceCollections) {
      const name = collInfo.name;
      const sourceColl = sourceDb.collection(name);
      const targetColl = targetDb.collection(name);

      // Fresh snapshot: drop any existing sandbox collection first.
      await targetColl.drop().catch((err) => {
        // 26 = NamespaceNotFound (collection did not exist) — safe to ignore.
        if (err && err.code !== 26) throw err;
      });

      // Copy documents in batches.
      let copied = 0;
      const cursor = sourceColl.find({}, { noCursorTimeout: false });
      let buffer = [];
      while (await cursor.hasNext()) {
        buffer.push(await cursor.next());
        if (buffer.length >= batchSize) {
          await targetColl.insertMany(buffer, { ordered: false });
          copied += buffer.length;
          buffer = [];
        }
      }
      if (buffer.length) {
        await targetColl.insertMany(buffer, { ordered: false });
        copied += buffer.length;
      }
      await cursor.close();

      // Recreate indexes (skip the default _id_ index which is auto-created).
      const indexes = await sourceColl.indexes();
      for (const idx of indexes) {
        if (idx.name === '_id_') continue;
        const { key, name: idxName, ...rest } = idx;
        delete rest.v; // index version is server-managed; don't forward it
        const options = rest;
        await targetColl.createIndex(key, { name: idxName, ...options }).catch(() => {
          /* best-effort: ignore index that cannot be recreated */
        });
      }

      results.push({ collection: name, documents: copied, indexes: indexes.length });
    }

    const finishedAt = new Date();

    return {
      source_database: sourceDbName,
      sandbox_database: targetDbName,
      same_cluster: sameCluster,
      collections_cloned: results.length,
      total_documents: results.reduce((sum, r) => sum + r.documents, 0),
      collections: results,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt - startedAt,
    };
  } finally {
    if (ownsClient && targetClient) {
      await targetClient.close().catch(() => {});
    }
  }
};

module.exports = { cloneProductionToSandbox, resolveSandboxTarget };
