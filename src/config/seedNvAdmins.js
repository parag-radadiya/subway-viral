require('dotenv').config();
const mongoose = require('mongoose');

const Role = require('../models/Role');
const User = require('../models/User');
const connectDB = require('./db');

const ROLE_DEFINITIONS = {
  Root: {
    can_create_users: true,
    can_view_all_staff: true,
    can_manage_rotas: true,
    can_manual_punch: true,
    can_manage_inventory: true,
    can_manage_shops: true,
    can_manage_roles: true,
    can_adjust_attendance_hours: true,
  },
  Admin: {
    can_create_users: true,
    can_view_all_staff: true,
    can_manage_rotas: true,
    can_manual_punch: true,
    can_manage_inventory: true,
    can_manage_shops: true,
    can_manage_roles: false,
    can_adjust_attendance_hours: true,
  },
  Manager: {
    can_create_users: false,
    can_view_all_staff: true,
    can_manage_rotas: true,
    can_manual_punch: true,
    can_manage_inventory: true,
    can_manage_shops: false,
    can_manage_roles: false,
    can_adjust_attendance_hours: false,
  },
  'Sub-Manager': {
    can_create_users: false,
    can_view_all_staff: false,
    can_manage_rotas: false,
    can_manual_punch: true,
    can_manage_inventory: true,
    can_manage_shops: false,
    can_manage_roles: false,
    can_adjust_attendance_hours: false,
  },
  Staff: {
    can_create_users: false,
    can_view_all_staff: false,
    can_manage_rotas: false,
    can_manual_punch: false,
    can_manage_inventory: false,
    can_manage_shops: false,
    can_manage_roles: false,
    can_adjust_attendance_hours: false,
  },
};

const SHARED_PASSWORD = process.env.NV_SEED_PASSWORD || 'NvSubway@1234';

const usersToUpsert = [
  {
    name: 'System Root',
    email: 'root@org.com',
    roleName: 'Root',
    phone_code: '+44',
    phone_num: '7000000010',
    must_change_password: false,
  },
  {
    name: 'Pragnesh',
    email: 'pragnesh@nvsubway.co.uk',
    roleName: 'Admin',
    phone_code: '+44',
    phone_num: '7000000011',
    must_change_password: false,
  },
  {
    name: 'Viral',
    email: 'viral@nvsubway.co.uk',
    roleName: 'Admin',
    phone_code: '+44',
    phone_num: '7000000012',
    must_change_password: false,
  },
  {
    name: 'Kalpesh',
    email: 'kalpesh@nvsubway.co.uk',
    roleName: 'Admin',
    phone_code: '+44',
    phone_num: '7000000013',
    must_change_password: false,
  },
];

const ensureRole = async (roleName, permissions) => {
  let role = await Role.findOne({ role_name: roleName });
  if (!role) {
    role = await Role.create({ role_name: roleName, permissions });
  } else {
    role.permissions = permissions;
    await role.save();
  }
  return role;
};

const upsertUser = async ({ roleId, ...userData }) => {
  const existing = await User.findOne({ email: userData.email.toLowerCase() });

  if (existing) {
    existing.name = userData.name;
    existing.phone_code = userData.phone_code;
    existing.phone_num = userData.phone_num;
    existing.role_id = roleId;
    existing.password_hash = SHARED_PASSWORD;
    existing.must_change_password = userData.must_change_password;
    existing.is_active = true;
    existing.device_id = existing.device_id || null;

    await existing.save();
    return { email: existing.email, action: 'updated' };
  }

  const created = await User.create({
    name: userData.name,
    email: userData.email.toLowerCase(),
    phone_code: userData.phone_code,
    phone_num: userData.phone_num,
    password_hash: SHARED_PASSWORD,
    role_id: roleId,
    must_change_password: userData.must_change_password,
    device_id: null,
  });

  return { email: created.email, action: 'created' };
};

const seedNvAdmins = async () => {
  await connectDB();

  console.log('Seeding NV root/admin users...');

  const roleByName = {};
  for (const [roleName, permissions] of Object.entries(ROLE_DEFINITIONS)) {
    roleByName[roleName] = await ensureRole(roleName, permissions);
  }

  const results = [];
  for (const userConfig of usersToUpsert) {
    const role = roleByName[userConfig.roleName];
    const result = await upsertUser({
      ...userConfig,
      roleId: role._id,
    });
    results.push(result);
  }

  for (const result of results) {
    console.log(`- ${result.email}: ${result.action}`);
  }

  console.log(`Done. Shared password used for all users: ${SHARED_PASSWORD}`);

  await mongoose.disconnect();
  process.exit(0);
};

seedNvAdmins().catch(async (err) => {
  console.error('NV seed failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
