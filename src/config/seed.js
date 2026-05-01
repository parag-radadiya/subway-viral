require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Role = require('../models/Role');
const User = require('../models/User');
const Shop = require('../models/Shop');
const Rota = require('../models/Rota');
const InventoryItem = require('../models/InventoryItem');

const connectDB = require('../config/db');

const seed = async () => {
  await connectDB();

  console.log('🌱 Starting seed...');

  // ─── Clean existing data ──────────────────────────────
  await Promise.all([
    Role.deleteMany({}),
    User.deleteMany({}),
    Shop.deleteMany({}),
    Rota.deleteMany({}),
    InventoryItem.deleteMany({}),
  ]);
  console.log('🗑️  Cleared existing seed collections');

  // ─── 1. Roles ─────────────────────────────────────────
  const roles = await Role.insertMany([
    {
      role_name: 'Root',
      permissions: {
        can_create_users: true,
        can_view_all_staff: true,
        can_manage_rotas: true,
        can_manual_punch: true,
        can_manage_inventory: true,
        can_manage_shops: true,
        can_manage_roles: true,
        can_adjust_attendance_hours: true,
      },
    },
    {
      role_name: 'Admin',
      permissions: {
        can_create_users: true,
        can_view_all_staff: true,
        can_manage_rotas: true,
        can_manual_punch: true,
        can_manage_inventory: true,
        can_manage_shops: true,
        can_manage_roles: false,
        can_adjust_attendance_hours: true,
      },
    },
    {
      role_name: 'Manager',
      permissions: {
        can_create_users: false,
        can_view_all_staff: true,
        can_manage_rotas: true,
        can_manual_punch: true,
        can_manage_inventory: true,
        can_manage_shops: false,
        can_manage_roles: false,
        can_adjust_attendance_hours: false,
      },
    },
    {
      role_name: 'Sub-Manager',
      permissions: {
        can_create_users: false,
        can_view_all_staff: false,
        can_manage_rotas: false,
        can_manual_punch: true,
        can_manage_inventory: true,
        can_manage_shops: false,
        can_manage_roles: false,
        can_adjust_attendance_hours: false,
      },
    },
    {
      role_name: 'Staff',
      permissions: {
        can_create_users: false,
        can_view_all_staff: false,
        can_manage_rotas: false,
        can_manual_punch: false,
        can_manage_inventory: false,
        can_manage_shops: false,
        can_manage_roles: false,
        can_adjust_attendance_hours: false,
      },
    },
  ]);

  const rootRole = roles.find((r) => r.role_name === 'Root');
  const adminRole = roles.find((r) => r.role_name === 'Admin');
  const managerRole = roles.find((r) => r.role_name === 'Manager');
  const subMgrRole = roles.find((r) => r.role_name === 'Sub-Manager');
  const staffRole = roles.find((r) => r.role_name === 'Staff');
  console.log(`✅ ${roles.length} roles created`);

  // ─── 2. Shops ─────────────────────────────────────────
  // const shops = await Shop.insertMany([
  //   {
  //     name: 'Main Branch',
  //     latitude: 51.5074,
  //     longitude: -0.1278,
  //     geofence_radius_m: 150,
  //     opening_time: '08:00',
  //     closing_time: '22:00',
  //   },
  //   {
  //     name: 'East Branch',
  //     latitude: 51.5155,
  //     longitude: -0.0922,
  //     geofence_radius_m: 100,
  //     opening_time: '08:00',
  //     closing_time: '22:00',
  //   },
  // ]);
  const mainShop = shops[0];
  const eastShop = shops[1];
  console.log(`✅ ${shops.length} shops created`);

  // ─── 3. Users ─────────────────────────────────────────
  // Note: password_hash triggers the bcrypt pre-save hook
  const usersRaw = [
    {
      name: 'System Root',
      email: 'root@org.com',
      phone_code: '+44',
      phone_num: '7000000000',
      password_hash: 'Root@1234', // ← change after first login
      role_id: rootRole._id,
      device_id: 'root-device-001',
      shop_id: mainShop._id,
      assigned_shop_ids: [mainShop._id, eastShop._id],
      must_change_password: false, // root already knows their creds
    },
    {
      name: 'Alice Admin',
      email: 'admin@org.com',
      phone_code: '+44',
      phone_num: '7000000001',
      password_hash: 'Admin@1234',
      role_id: adminRole._id,
      device_id: 'admin-device-001',
      shop_id: mainShop._id,
      assigned_shop_ids: [mainShop._id, eastShop._id],
      must_change_password: true,
    },
    {
      name: 'Bob Manager',
      email: 'manager@org.com',
      phone_code: '+44',
      phone_num: '7000000002',
      password_hash: 'Manager@1234',
      role_id: managerRole._id,
      device_id: 'mgr-device-001',
      shop_id: mainShop._id,
      assigned_shop_ids: [mainShop._id, eastShop._id],
      must_change_password: true,
    },
    {
      name: 'Carol Sub-Manager',
      email: 'submanager@org.com',
      phone_code: '+44',
      phone_num: '7000000003',
      password_hash: 'SubMgr@1234',
      role_id: subMgrRole._id,
      device_id: 'submgr-device-001',
      shop_id: mainShop._id,
      assigned_shop_ids: [mainShop._id, eastShop._id],
      must_change_password: true,
    },
    {
      name: 'Dave Staff',
      email: 'staff@org.com',
      phone_code: '+44',
      phone_num: '7000000004',
      password_hash: 'Staff@1234',
      role_id: staffRole._id,
      device_id: 'staff-device-001',
      shop_id: mainShop._id,
      assigned_shop_ids: [mainShop._id],
      must_change_password: true,
    },
  ];

  // Create one by one to trigger the pre-save bcrypt hook on each
  const users = [];
  for (const u of usersRaw) {
    const created = await User.create(u);
    users.push(created);
  }

  const rootUser = users[0];
  const staffUser = users[4];
  console.log(`✅ ${users.length} users created`);

  // // ─── 4. Rotas ─────────────────────────────────────────
  // const today = new Date();
  // const tomorrow = new Date(today);
  // tomorrow.setDate(today.getDate() + 1);
  //
  // await Rota.insertMany([
  //   {
  //     user_id: staffUser._id,
  //     shop_id: mainShop._id,
  //     shift_date: today,
  //     start_time: '09:00',
  //   },
  //   {
  //     user_id: staffUser._id,
  //     shop_id: eastShop._id,
  //     shift_date: tomorrow,
  //     start_time: '10:00',
  //   },
  // ]);
  // console.log('✅ 2 rotas created');
  //
  // // ─── 5. Inventory Items ───────────────────────────────
  // await InventoryItem.insertMany([
  //   {
  //     shop_id: mainShop._id,
  //     item_name: 'Cash Register',
  //     purchase_date: new Date('2024-01-15'),
  //     expiry_date: null,
  //     status: 'Good',
  //   },
  //   {
  //     shop_id: mainShop._id,
  //     item_name: 'Barcode Scanner',
  //     purchase_date: new Date('2023-06-10'),
  //     expiry_date: null,
  //     status: 'Good',
  //   },
  //   {
  //     shop_id: eastShop._id,
  //     item_name: 'Display Monitor',
  //     purchase_date: new Date('2022-11-20'),
  //     expiry_date: null,
  //     status: 'Good',
  //   },
  //   {
  //     shop_id: eastShop._id,
  //     item_name: 'Fire Extinguisher',
  //     purchase_date: new Date('2023-03-01'),
  //     expiry_date: new Date('2026-03-01'),
  //     status: 'Good',
  //   },
  // ]);
  // console.log('✅ 4 inventory items created');

  // ─── Summary ──────────────────────────────────────────
  console.log('\n🎉 Seed complete! Default credentials:\n');
  console.log('  Role       | Email                  | Password');
  console.log('  -----------|------------------------|-------------');
  console.log('  Root       | root@org.com           | Root@1234');
  console.log('  Admin      | admin@org.com          | Admin@1234');
  console.log('  Manager    | manager@org.com        | Manager@1234');
  console.log('  Sub-Mgr    | submanager@org.com     | SubMgr@1234');
  console.log('  Staff      | staff@org.com          | Staff@1234');
  console.log('\n⚠️  Change all passwords after first login!\n');

  await mongoose.disconnect();
  process.exit(0);
};

seed().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
