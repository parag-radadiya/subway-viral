require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('./db');
const Role = require('../models/Role');
const Shop = require('../models/Shop');
const User = require('../models/User');
const Attendance = require('../models/Attendance');

const SHOP_NAME = 'Test Adjust Test Shop';
const TEST_USERS = [
  {
    name: 'Test Staff One',
    email: 'Test.staff1@org.com',
    role: 'Staff',
    password: 'Staff1@1234',
    device_id: 'Test-staff-device-1',
  },
  {
    name: 'Test Staff Two',
    email: 'Test.staff2@org.com',
    role: 'Staff',
    password: 'Staff2@1234',
    device_id: 'Test-staff-device-2',
  },
  {
    name: 'Test Staff Three',
    email: 'Test.staff3@org.com',
    role: 'Staff',
    password: 'Staff3@1234',
    device_id: 'Test-staff-device-3',
  },
  {
    name: 'Test Sub Manager',
    email: 'Test.submanager@org.com',
    role: 'Sub-Manager',
    password: 'SubMgr@1234',
    device_id: 'Test-submgr-device-1',
  },
];

function getLastMonthRangeUtc() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
  return { start, end };
}

function eachDateUtc(start, end) {
  const out = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const finish = new Date(end);
  finish.setUTCHours(0, 0, 0, 0);

  while (cursor <= finish) {
    out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return out;
}

function buildShifts(userIndex, day) {
  const dayStart = new Date(day);
  dayStart.setUTCHours(0, 0, 0, 0);

  const dayBaseHourByUser = [8, 9, 10, 11][userIndex % 4];
  const dayDurationByUser = [8, 8, 7, 7][userIndex % 4];
  const eveningBaseHourByUser = [16, 17, 18, 15][userIndex % 4];
  const eveningDurationByUser = [5, 4, 4, 6][userIndex % 4];

  const dayPunchIn = new Date(dayStart);
  dayPunchIn.setUTCHours(dayBaseHourByUser, 0, 0, 0);
  const dayPunchOut = new Date(dayPunchIn);
  dayPunchOut.setUTCHours(dayBaseHourByUser + dayDurationByUser, 0, 0, 0);

  const eveningPunchIn = new Date(dayStart);
  eveningPunchIn.setUTCHours(eveningBaseHourByUser, 0, 0, 0);
  const eveningPunchOut = new Date(eveningPunchIn);
  eveningPunchOut.setUTCHours(eveningBaseHourByUser + eveningDurationByUser, 0, 0, 0);

  return [
    { punchIn: dayPunchIn, punchOut: dayPunchOut },
    { punchIn: eveningPunchIn, punchOut: eveningPunchOut },
  ];
}

async function ensureRole(roleName, defaultPermissions = {}) {
  let role = await Role.findOne({ role_name: roleName });
  if (!role && roleName === 'Sub-Manager') {
    role = await Role.findOne({ role_name: 'Sub Manager' });
  }
  if (!role && roleName === 'Sub Manager') {
    role = await Role.findOne({ role_name: 'Sub-Manager' });
  }

  if (!role) {
    role = await Role.create({
      role_name: roleName,
      permissions: {
        can_manual_punch: false,
        can_view_all_staff: false,
        can_create_users: false,
        can_manage_inventory: false,
        can_manage_rotas: false,
        can_adjust_attendance_hours: false,
        can_manage_shops: false,
        can_manage_roles: false,
        ...defaultPermissions,
      },
    });
  }

  return role;
}

async function ensureShop() {
  let shop = await Shop.findOne({ name: SHOP_NAME });
  if (!shop) {
    shop = await Shop.create({
      name: SHOP_NAME,
      latitude: 51.5014,
      longitude: -0.1419,
      geofence_radius_m: 120,
      opening_time: '08:00',
      closing_time: '22:00',
      shop_time_history: [
        {
          opening_time: '08:00',
          closing_time: '22:00',
          effective_from: new Date(),
          effective_to: null,
          changed_at: new Date(),
          changed_by: null,
          note: 'Seeded for Test adjust testing',
        },
      ],
    });
  }
  return shop;
}

async function ensureUser(userSeed, shopId, roleMap) {
  const role = roleMap.get(userSeed.role);
  if (!role) {
    throw new Error(`Missing role: ${userSeed.role}`);
  }

  let user = await User.findOne({ email: userSeed.email });
  if (!user) {
    user = new User({
      name: userSeed.name,
      email: userSeed.email,
      phone_code: '+44',
      phone_num: String(Math.floor(7000000000 + Math.random() * 10000000)),
      password_hash: userSeed.password,
      role_id: role._id,
      device_id: userSeed.device_id,
      shop_id: shopId,
      active_shop_id: shopId,
      assigned_shop_ids: [shopId],
      must_change_password: false,
      is_active: true,
    });
    await user.save();
    return user;
  }

  user.name = userSeed.name;
  user.role_id = role._id;
  user.device_id = userSeed.device_id;
  user.shop_id = shopId;
  user.active_shop_id = shopId;
  user.assigned_shop_ids = [shopId];
  user.must_change_password = false;
  user.is_active = true;
  await user.save();
  return user;
}

async function seedAttendance(shopId, users) {
  const { start, end } = getLastMonthRangeUtc();
  const days = eachDateUtc(start, end).filter((d) => {
    const dow = d.getUTCDay();
    return dow !== 0;
  });

  const ops = [];
  users.forEach((user, userIndex) => {
    days.forEach((day) => {
      const shifts = buildShifts(userIndex, day);
      shifts.forEach(({ punchIn, punchOut }) => {
        ops.push({
          updateOne: {
            filter: {
              user_id: user._id,
              shop_id: shopId,
              punch_in: punchIn,
            },
            update: {
              $setOnInsert: {
                user_id: user._id,
                shop_id: shopId,
                punch_in: punchIn,
                punch_out: punchOut,
                punch_method: 'GPS+Biometric',
                is_manual: false,
                manual_by: null,
                punch_out_source: 'Manual',
              },
            },
            upsert: true,
          },
        });
      });
    });
  });

  if (ops.length === 0) {
    return { upsertedCount: 0, matchedCount: 0 };
  }

  const result = await Attendance.bulkWrite(ops, { ordered: false });
  return {
    upsertedCount: result.upsertedCount || 0,
    matchedCount: result.matchedCount || 0,
  };
}

async function run() {
  await connectDB();

  const staffRole = await ensureRole('Staff');
  const subManagerRole = await ensureRole('Sub-Manager', {
    can_manual_punch: true,
    can_manage_inventory: true,
  });

  const roleMap = new Map([
    ['Staff', staffRole],
    ['Sub-Manager', subManagerRole],
  ]);

  const shop = await ensureShop();

  const users = [];
  for (const userSeed of TEST_USERS) {
    const user = await ensureUser(userSeed, shop._id, roleMap);
    users.push(user);
  }

  const attendanceSummary = await seedAttendance(shop._id, users);

  console.log('Test adjust test data seeded successfully');
  console.log(`Shop: ${shop.name} (${shop._id})`);
  users.forEach((user) => {
    console.log(`User: ${user.email} (${user._id})`);
  });
  console.log(`Attendance upserted: ${attendanceSummary.upsertedCount}`);
  console.log(`Attendance matched(existing): ${attendanceSummary.matchedCount}`);
}

run()
  .catch((error) => {
    console.error('Failed to seed Test-adjust test data:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
