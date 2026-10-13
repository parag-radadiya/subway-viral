require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../db');
const Role = require('../../models/Role');

// Grants the Manager role:
//   - can_create_users            : create/edit users (scoped: own shops, no Admin/Root)
//   - can_adjust_attendance_hours : single + bulk hours adjustment (own shops)
//   - can_manage_roles            : manage roles (scoped: no Admin/Root/own role,
//                                   cannot grant permissions the Manager lacks)
//
// The scoping guards live in src/utils/roleGuards.js — deploy that code BEFORE
// running this against a live database.
//
// Usage:
//   node src/config/migrations/grantManagerUserRoleAttendancePermissions.js [--dry-run]
//     [--permissions=can_adjust_attendance_hours,...]   (default: all three)
const ALL_PERMISSIONS = ['can_create_users', 'can_adjust_attendance_hours', 'can_manage_roles'];

function parsePermissions(argv) {
  const arg = argv.find((a) => a.startsWith('--permissions='));
  if (!arg) return ALL_PERMISSIONS;
  const requested = arg
    .split('=')[1]
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const unknown = requested.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (unknown.length || requested.length === 0) {
    throw new Error(`Unknown/empty --permissions: ${unknown.join(', ')}`);
  }
  return requested;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const PERMISSIONS = parsePermissions(process.argv);
  await connectDB();

  const role = await Role.findOne({ role_name: 'Manager' }).lean();
  if (!role) throw new Error('Manager role not found');

  const before = ALL_PERMISSIONS.reduce((acc, key) => {
    acc[key] = Boolean(role.permissions?.[key]);
    return acc;
  }, {});
  console.log('Manager permissions before:', before);

  if (dryRun) {
    console.log('Dry run — no changes written.');
  } else {
    const $set = PERMISSIONS.reduce((acc, key) => {
      acc[`permissions.${key}`] = true;
      return acc;
    }, {});
    const result = await Role.updateOne({ _id: role._id }, { $set });
    const after = await Role.findById(role._id).lean();
    console.log(
      `Updated Manager role. matched=${result.matchedCount}, modified=${result.modifiedCount}`
    );
    console.log('Manager permissions after:', after.permissions);
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('Migration failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
