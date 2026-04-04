require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../db');
const Role = require('../../models/Role');

async function run() {
  await connectDB();

  await Role.updateMany(
    {
      'permissions.can_adjust_attendance_hours': { $exists: false },
    },
    {
      $set: { 'permissions.can_adjust_attendance_hours': false },
    }
  );

  const result = await Role.updateMany(
    { role_name: { $in: ['Admin', 'Root'] } },
    { $set: { 'permissions.can_adjust_attendance_hours': true } }
  );

  console.log(
    `Updated attendance-adjust permission for roles. matched=${result.matchedCount || result.n || 0}, modified=${result.modifiedCount || result.nModified || 0}`
  );

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('Migration failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
