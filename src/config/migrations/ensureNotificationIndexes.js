'use strict';

// One-shot script to pre-create indexes for the `notifications` collection.
// Not strictly required — Mongoose auto-creates indexes on first model load —
// but useful in production to guarantee the unique partial index on
// (recipient_id, dedupe_key) exists before the first write, so dedupe works
// from the very first event.
//
// Run with:  npm run migrate:notification-indexes

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../db');
const Notification = require('../../models/Notification');

async function run() {
  await connectDB();

  console.log('🔧  Ensuring notification indexes...');
  await Notification.syncIndexes();

  const indexes = await Notification.collection.indexes();
  console.log(`✅  Done. ${indexes.length} indexes on notifications:`);
  indexes.forEach((idx) => {
    const partial = idx.partialFilterExpression
      ? ` (partial: ${JSON.stringify(idx.partialFilterExpression)})`
      : '';
    const unique = idx.unique ? ' UNIQUE' : '';
    console.log(`  - ${idx.name}${unique}${partial}`);
  });

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Index sync failed:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});
