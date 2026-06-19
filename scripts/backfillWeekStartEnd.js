#!/usr/bin/env node
// Backfill week_start / week_end on weekly_financial rows where they are null.
// Uses month boundaries derived from (year, month) — matches the same fallback
// applied at write time (see upsertSingleWeekly2026 / upsertAdminWeeklyData).
//
// Usage:
//   node scripts/backfillWeekStartEnd.js           # apply
//   node scripts/backfillWeekStartEnd.js --dry-run # report only

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const StoreReportWeekly2026B = require('../src/models/StoreReportWeekly2026B');
const StoreReportEntry = require('../src/models/StoreReportEntry');

const DRY_RUN = process.argv.includes('--dry-run');

function monthBounds(year, month) {
  return {
    weekStart: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    weekEnd: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}

async function backfillCollection(Model, label, extraFilter = {}) {
  const filter = {
    ...extraFilter,
    $or: [{ week_start: null }, { week_end: null }],
  };
  const rows = await Model.find(filter, { _id: 1, year: 1, month: 1, week_start: 1, week_end: 1 });
  console.log(`[${label}] candidates: ${rows.length}`);

  if (rows.length === 0) return { matched: 0, updated: 0 };

  let updated = 0;
  for (const row of rows) {
    if (!row.year || !row.month) continue;
    const { weekStart, weekEnd } = monthBounds(row.year, row.month);
    const set = {};
    if (!row.week_start) set.week_start = weekStart;
    if (!row.week_end) set.week_end = weekEnd;
    if (Object.keys(set).length === 0) continue;
    if (DRY_RUN) {
      updated += 1;
      continue;
    }
    await Model.updateOne({ _id: row._id }, { $set: set });
    updated += 1;
  }
  console.log(`[${label}] ${DRY_RUN ? 'would update' : 'updated'}: ${updated}`);
  return { matched: rows.length, updated };
}

(async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set');
    process.exit(1);
  }
  await connectDB();
  console.log(DRY_RUN ? '== DRY RUN ==' : '== APPLYING ==');
  try {
    const a = await backfillCollection(StoreReportWeekly2026B, 'StoreReportWeekly2026B');
    const b = await backfillCollection(StoreReportEntry, 'StoreReportEntry weekly_financial', {
      report_type: 'weekly_financial',
    });
    console.log(
      `Total candidates: ${a.matched + b.matched}, ${DRY_RUN ? 'would update' : 'updated'}: ${a.updated + b.updated}`
    );
  } finally {
    await mongoose.disconnect();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
