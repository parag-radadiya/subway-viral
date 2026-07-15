'use strict';

// Backfills the two additive Shop flags introduced alongside this migration:
//   - is_active:     defaults every existing shop to true (open) unless already set
//   - is_all_shops:  true for the special "All Shops" aggregate record, false otherwise
//
// The "All Shops" record is matched by name (case-insensitive, trimmed). Adjust
// ALL_SHOPS_NAMES below if your aggregate row uses a different label.
//
// Run: node src/config/migrations/setShopActiveAndAllShopsFlags.js

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../db');
const Shop = require('../../models/Shop');

const ALL_SHOPS_NAMES = ['all shops', 'all shop'];

async function run() {
  await connectDB();

  const shops = await Shop.find({});
  console.log(`Found ${shops.length} shops total`);

  let activeSet = 0;
  let allShopsSet = 0;

  for (const shop of shops) {
    let changed = false;

    if (shop.is_active === undefined || shop.is_active === null) {
      shop.is_active = true;
      activeSet++;
      changed = true;
    }

    const isAggregate = ALL_SHOPS_NAMES.includes(String(shop.name || '').trim().toLowerCase());
    if (Boolean(shop.is_all_shops) !== isAggregate) {
      shop.is_all_shops = isAggregate;
      allShopsSet++;
      changed = true;
    }

    if (changed) {
      await shop.save();
      console.log(
        `  UPDATE "${shop.name}" — is_active=${shop.is_active} is_all_shops=${shop.is_all_shops}`
      );
    }
  }

  console.log(`\nDone. is_active backfilled=${activeSet}  is_all_shops set=${allShopsSet}`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Migration failed:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});
