/**
 * POST /api/sandbox/clone  (Root only)
 * Clones the production (connected) database into a sibling sandbox database.
 * Covers: role gating, confirmation guard, and that data actually lands in sandbox.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const { expectEnvelope } = require('../helpers/assertions');
const { login, authHeader } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('POST /api/sandbox/clone', () => {
  let fixtures;
  let rootToken;
  let adminToken;

  beforeAll(async () => {
    await connectSandboxDb();
  });

  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();
    ({ token: rootToken } = await login('root@org.com', 'Root@1234'));
    ({ token: adminToken } = await login('admin@org.com', 'Admin@1234'));
  });

  afterAll(async () => {
    // Drop the sibling sandbox db created during the test, then disconnect.
    const sandboxName = `${mongoose.connection.db.databaseName}_sandbox`;
    await mongoose.connection
      .getClient()
      .db(sandboxName)
      .dropDatabase()
      .catch(() => {});
    await disconnectSandboxDb();
  });

  it('clones production collections into the sandbox database for Root', async () => {
    const productionUsers = await User.countDocuments();
    expect(productionUsers).toBeGreaterThan(0);

    const res = await request(app)
      .post('/api/sandbox/clone')
      .set(authHeader(rootToken))
      .send({ confirm: true });

    expectEnvelope(res, 200);
    expect(res.body.data.sandbox_database).toBe(`${mongoose.connection.db.databaseName}_sandbox`);
    expect(res.body.data.collections_cloned).toBeGreaterThan(0);
    expect(res.body.data.total_documents).toBeGreaterThan(0);

    // The sandbox db should now hold the same users as production.
    const sandboxDb = mongoose.connection.getClient().db(res.body.data.sandbox_database);
    const sandboxUsers = await sandboxDb.collection('users').countDocuments();
    expect(sandboxUsers).toBe(productionUsers);
  });

  it('rejects non-Root callers with 403', async () => {
    const res = await request(app)
      .post('/api/sandbox/clone')
      .set(authHeader(adminToken))
      .send({ confirm: true });

    expectEnvelope(res, 403);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/sandbox/clone').send({ confirm: true });
    expectEnvelope(res, 401);
  });

  it('requires an explicit confirm flag', async () => {
    const res = await request(app).post('/api/sandbox/clone').set(authHeader(rootToken)).send({});

    expectEnvelope(res, 400);
    expect(res.body.message).toMatch(/confirm/i);
  });
});
