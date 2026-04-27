const Role = require('../../src/models/Role');
const User = require('../../src/models/User');
const Shop = require('../../src/models/Shop');
const Rota = require('../../src/models/Rota');
const InventoryItem = require('../../src/models/InventoryItem');

const seedTestData = async () => {
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

  const rootRole = roles.find((role) => role.role_name === 'Root');
  const adminRole = roles.find((role) => role.role_name === 'Admin');
  const managerRole = roles.find((role) => role.role_name === 'Manager');
  const subMgrRole = roles.find((role) => role.role_name === 'Sub-Manager');
  const staffRole = roles.find((role) => role.role_name === 'Staff');

  const shops = await Shop.insertMany([
    {
      name: 'Main Branch',
      aliases: ['Baker St', 'BAKER ST'],
      latitude: 51.5074,
      longitude: -0.1278,
      geofence_radius_m: 150,
      opening_time: '08:00',
      closing_time: '22:00',
    },
    {
      name: 'East Branch',
      aliases: ['Camden', 'Camden Town'],
      latitude: 51.5155,
      longitude: -0.0922,
      geofence_radius_m: 100,
      opening_time: '08:00',
      closing_time: '22:00',
    },
  ]);

  const mainShop = shops[0];
  const eastShop = shops[1];

  const users = [];
  users.push(
    await User.create({
      name: 'System Root',
      email: 'root@org.com',
      phone_code: '+44',
      phone_num: '7000000000',
      password_hash: 'Root@1234',
      role_id: rootRole._id,
      device_id: 'root-device-001',
      shop_id: mainShop._id,
      assigned_shop_ids: [mainShop._id, eastShop._id],
      must_change_password: false,
    })
  );

  users.push(
    await User.create({
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
    })
  );

  users.push(
    await User.create({
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
    })
  );

  users.push(
    await User.create({
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
    })
  );

  users.push(
    await User.create({
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
    })
  );

  const [rootUser, adminUser, managerUser, subManagerUser, staffUser] = users;

  const today = new Date('2026-03-16T00:00:00.000Z');
  await Rota.insertMany([
    {
      user_id: staffUser._id,
      shop_id: mainShop._id,
      shift_date: today,
      start_time: '09:00',
      end_time: '17:00',
    },
    {
      user_id: staffUser._id,
      shop_id: eastShop._id,
      shift_date: new Date('2026-03-17T00:00:00.000Z'),
      start_time: '10:00',
      end_time: '18:00',
    },
  ]);

  const inventoryItems = await InventoryItem.insertMany([
    {
      shop_id: mainShop._id,
      item_name: 'Cash Register',
      purchase_date: new Date('2024-01-15'),
      status: 'Good',
    },
    {
      shop_id: eastShop._id,
      item_name: 'Display Monitor',
      purchase_date: new Date('2022-11-20'),
      status: 'Good',
    },
  ]);

  return {
    roles: { rootRole, adminRole, managerRole, subMgrRole, staffRole },
    users: { rootUser, adminUser, managerUser, subManagerUser, staffUser },
    shops: { mainShop, eastShop },
    inventoryItems,
  };
};

module.exports = { seedTestData };
