require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../db');
const Role = require('../../models/Role');

// Grants the two new permissions introduced for:
//   - can_correct_attendance : manager/admin/sub-manager may correct punch_in/out
//   - can_delete_staff        : manager/admin/sub-manager may deactivate staff
//
// Existing roles get the keys defaulted to false first (so every role has the
// flag), then Root/Admin/Manager/Sub-Manager are granted both.
async function run() {
  await connectDB();

  await Role.updateMany(
    { 'permissions.can_correct_attendance': { $exists: false } },
    { $set: { 'permissions.can_correct_attendance': false } }
  );
  await Role.updateMany(
    { 'permissions.can_delete_staff': { $exists: false } },
    { $set: { 'permissions.can_delete_staff': false } }
  );

  const result = await Role.updateMany(
    { role_name: { $in: ['Root', 'Admin', 'Manager', 'Sub-Manager'] } },
    {
      $set: {
        'permissions.can_correct_attendance': true,
        'permissions.can_delete_staff': true,
      },
    }
  );

  console.log(
    `Granted correct-attendance & delete-staff permissions. matched=${
      result.matchedCount || result.n || 0
    }, modified=${result.modifiedCount || result.nModified || 0}`
  );

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('Migration failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
