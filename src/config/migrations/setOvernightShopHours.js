'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../db');
const Shop = require('../../models/Shop');

const OPEN = '07:00';
const CLOSE = '05:00';
const NOTE = 'Migrated to overnight operating hours (07:00 – 05:00 next day)';

async function run() {
  await connectDB();

  const shops = await Shop.find({});
  console.log(`Found ${shops.length} shops total`);

  let updated = 0;
  let skipped = 0;

  for (const shop of shops) {
    if (shop.opening_time === OPEN && shop.closing_time === CLOSE) {
      skipped++;
      console.log(`  SKIP  "${shop.name}" — already ${OPEN} → ${CLOSE}`);
      continue;
    }

    const prev = { open: shop.opening_time, close: shop.closing_time };

    // Close out any open-ended history entry
    const history = Array.isArray(shop.shop_time_history) ? shop.shop_time_history : [];
    const now = new Date();
    if (history.length > 0) {
      const last = history[history.length - 1];
      if (!last.effective_to) {
        last.effective_to = now;
      }
    }

    // Append new overnight history entry
    history.push({
      opening_time: OPEN,
      closing_time: CLOSE,
      effective_from: now,
      effective_to: null,
      changed_at: now,
      changed_by: null,
      note: NOTE,
    });

    shop.opening_time = OPEN;
    shop.closing_time = CLOSE;
    shop.shop_time_history = history;

    await shop.save();
    updated++;
    console.log(`  UPDATE "${shop.name}" — ${prev.open}→${prev.close}  =>  ${OPEN}→${CLOSE}`);
  }

  console.log(`\nDone. updated=${updated}  skipped=${skipped}`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Migration failed:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});
