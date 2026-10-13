/**
 * Manager now has can_create_users, can_adjust_attendance_hours and
 * can_manage_roles. These tests pin the guards that keep those grants scoped:
 * own shops only, no Admin/Root users or roles, no self-escalation.
 */
const request = require('supertest');
const app = require('../../src/app');
const Shop = require('../../src/models/Shop');
const User = require('../../src/models/User');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('Manager permission guards', () => {
  let fixtures;
  let outsideShop;
  let auth;

  beforeAll(async () => {
    await connectSandboxDb();
  });

  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();
    outsideShop = await Shop.create({
      name: 'North Branch',
      latitude: 51.55,
      longitude: -0.15,
      geofence_radius_m: 100,
    });
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    auth = { Authorization: `Bearer ${managerLogin.token}` };
  });

  afterAll(async () => {
    await disconnectSandboxDb();
  });

  const newUser = (overrides = {}) => ({
    name: 'New Starter',
    email: `starter-${Date.now()}-${Math.random().toString(36).slice(2)}@org.com`,
    phone_code: '+44',
    phone_num: '7000000099',
    password: 'Starter@1234',
    ...overrides,
  });

  describe('users', () => {
    it('MGR-001: manager can create a Staff user in an assigned shop', async () => {
      const res = await request(app)
        .post('/api/users')
        .set(auth)
        .send(
          newUser({ role_id: fixtures.roles.staffRole._id, shop_id: fixtures.shops.mainShop._id })
        );
      expectEnvelope(res, 201);
      expect(res.body.data.user.role_id.role_name).toBe('Staff');
    });

    it('MGR-002: manager cannot create Admin/Root users', async () => {
      for (const role of [fixtures.roles.adminRole, fixtures.roles.rootRole]) {
        const res = await request(app)
          .post('/api/users')
          .set(auth)
          .send(newUser({ role_id: role._id, shop_id: fixtures.shops.mainShop._id }));
        expectEnvelope(res, 403);
      }
    });

    it('MGR-003: manager cannot create users outside their shops or with no shop', async () => {
      const outside = await request(app)
        .post('/api/users')
        .set(auth)
        .send(newUser({ role_id: fixtures.roles.staffRole._id, shop_id: outsideShop._id }));
      expectEnvelope(outside, 403);

      const sneakyAssigned = await request(app)
        .post('/api/users')
        .set(auth)
        .send(
          newUser({
            role_id: fixtures.roles.staffRole._id,
            shop_id: fixtures.shops.mainShop._id,
            assigned_shop_ids: [outsideShop._id],
          })
        );
      expectEnvelope(sneakyAssigned, 403);

      const noShop = await request(app)
        .post('/api/users')
        .set(auth)
        .send(newUser({ role_id: fixtures.roles.staffRole._id }));
      expectEnvelope(noShop, 403);
    });

    it('MGR-004: manager can edit staff in their shop but not move them out', async () => {
      const staffId = fixtures.users.staffUser._id;
      const ok = await request(app)
        .put(`/api/users/${staffId}`)
        .set(auth)
        .send({ name: 'Dave Renamed' });
      expectEnvelope(ok, 200);
      expect(ok.body.data.user.name).toBe('Dave Renamed');

      const moveOut = await request(app)
        .put(`/api/users/${staffId}`)
        .set(auth)
        .send({ shop_id: outsideShop._id, assigned_shop_ids: [outsideShop._id] });
      expectEnvelope(moveOut, 403);
    });

    it('MGR-005: manager cannot edit Admin/Root users or promote anyone to Admin', async () => {
      const editAdmin = await request(app)
        .put(`/api/users/${fixtures.users.adminUser._id}`)
        .set(auth)
        .send({ name: 'Hacked' });
      expectEnvelope(editAdmin, 403);

      const promote = await request(app)
        .put(`/api/users/${fixtures.users.staffUser._id}`)
        .set(auth)
        .send({ role_id: fixtures.roles.adminRole._id });
      expectEnvelope(promote, 403);
    });

    it('MGR-006: manager cannot change their own role', async () => {
      const res = await request(app)
        .put(`/api/users/${fixtures.users.managerUser._id}`)
        .set(auth)
        .send({ role_id: fixtures.roles.subMgrRole._id });
      expectEnvelope(res, 403);
    });

    it('MGR-007: admin is unaffected and can still create Admin users anywhere', async () => {
      const adminLogin = await login('admin@org.com', 'Admin@1234');
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminLogin.token}`)
        .send(newUser({ role_id: fixtures.roles.adminRole._id, shop_id: outsideShop._id }));
      expectEnvelope(res, 201);
    });
  });

  describe('roles', () => {
    it('MGR-010: manager can list roles', async () => {
      const res = await request(app).get('/api/roles').set(auth);
      expectEnvelope(res, 200);
    });

    it('MGR-011: manager cannot modify or delete Admin/Root roles or their own role', async () => {
      const { adminRole, rootRole, managerRole } = fixtures.roles;
      for (const role of [adminRole, rootRole, managerRole]) {
        const put = await request(app)
          .put(`/api/roles/${role._id}`)
          .set(auth)
          .send({ permissions: { ...role.permissions, can_manual_punch: false } });
        expectEnvelope(put, 403);
        const del = await request(app).delete(`/api/roles/${role._id}`).set(auth);
        expectEnvelope(del, 403);
      }
    });

    it('MGR-012: manager can edit a lower role only with permissions they hold', async () => {
      const { subMgrRole } = fixtures.roles;
      const ok = await request(app)
        .put(`/api/roles/${subMgrRole._id}`)
        .set(auth)
        .send({ permissions: { ...subMgrRole.permissions, can_manage_rotas: true } });
      expectEnvelope(ok, 200);
      expect(ok.body.data.role.permissions.can_manage_rotas).toBe(true);

      const escalate = await request(app)
        .put(`/api/roles/${subMgrRole._id}`)
        .set(auth)
        .send({ permissions: { ...subMgrRole.permissions, can_manage_shops: true } });
      expectEnvelope(escalate, 403);
    });

    it('MGR-013: manager cannot create reserved role names or escalated roles', async () => {
      const reserved = await request(app)
        .post('/api/roles')
        .set(auth)
        .send({ role_name: 'admin', permissions: {} });
      expectEnvelope(reserved, 403);

      const escalated = await request(app)
        .post('/api/roles')
        .set(auth)
        .send({ role_name: 'Shift Lead', permissions: { can_manage_shops: true } });
      expectEnvelope(escalated, 403);
    });

    it('MGR-014: manager can create and delete an unused role, but not one in use', async () => {
      const created = await request(app)
        .post('/api/roles')
        .set(auth)
        .send({ role_name: 'Shift Lead', permissions: { can_manual_punch: true } });
      expectEnvelope(created, 201);

      const del = await request(app).delete(`/api/roles/${created.body.data.role._id}`).set(auth);
      expectEnvelope(del, 200);

      const inUse = await request(app)
        .delete(`/api/roles/${fixtures.roles.staffRole._id}`)
        .set(auth);
      expectEnvelope(inUse, 403);
    });
  });

  describe('lists', () => {
    const adminAuth = async () => {
      const adminLogin = await login('admin@org.com', 'Admin@1234');
      return { Authorization: `Bearer ${adminLogin.token}` };
    };

    const createStaff = (overrides) =>
      User.create({
        name: 'Extra Staff',
        email: `extra-${Date.now()}-${Math.random().toString(36).slice(2)}@org.com`,
        phone_code: '+44',
        phone_num: '7000000098',
        password_hash: 'Extra@1234',
        role_id: fixtures.roles.staffRole._id,
        ...overrides,
      });

    it('MGR-030: manager roles list only has Staff, Sub-Manager and Manager', async () => {
      const res = await request(app).get('/api/roles?limit=100').set(auth);
      expectEnvelope(res, 200);
      const names = res.body.data.roles.map((role) => role.role_name).sort();
      expect(names).toEqual(['Manager', 'Staff', 'Sub-Manager']);
      expect(res.body.data.total).toBe(3);
    });

    it('MGR-031: manager cannot fetch Admin/Root roles by id', async () => {
      const admin = await request(app).get(`/api/roles/${fixtures.roles.adminRole._id}`).set(auth);
      expectEnvelope(admin, 404);
      const staff = await request(app).get(`/api/roles/${fixtures.roles.staffRole._id}`).set(auth);
      expectEnvelope(staff, 200);
    });

    it('MGR-032: root still sees every role', async () => {
      const rootLogin = await login('root@org.com', 'Root@1234');
      const res = await request(app)
        .get('/api/roles?limit=100')
        .set({ Authorization: `Bearer ${rootLogin.token}` });
      expectEnvelope(res, 200);
      expect(res.body.data.roles).toHaveLength(5);
    });

    it('MGR-033: manager users list only has Staff/Sub-Managers in their shops', async () => {
      await createStaff({
        name: 'Assigned Only',
        assigned_shop_ids: [fixtures.shops.eastShop._id],
      });
      await createStaff({ name: 'Outsider', shop_id: outsideShop._id });

      const res = await request(app).get('/api/users?limit=100').set(auth);
      expectEnvelope(res, 200);
      const names = res.body.data.users.map((user) => user.name);
      const roles = new Set(res.body.data.users.map((user) => user.role_id.role_name));

      expect(names).toEqual(expect.arrayContaining(['Dave Staff', 'Assigned Only']));
      expect(names).not.toContain('Outsider');
      expect([...roles].sort()).toEqual(['Staff', 'Sub-Manager']);
      expect(res.body.data.total).toBe(res.body.data.users.length);
    });

    it('MGR-034: manager users list ignores role_id filters for hidden roles', async () => {
      const { managerRole, adminRole, staffRole } = fixtures.roles;
      const hidden = await request(app)
        .get(`/api/users?role_id=${managerRole._id},${adminRole._id}`)
        .set(auth);
      expectEnvelope(hidden, 200);
      expect(hidden.body.data.users).toHaveLength(0);

      const staff = await request(app).get(`/api/users?role_id=${staffRole._id}`).set(auth);
      expectEnvelope(staff, 200);
      expect(staff.body.data.users.every((u) => u.role_id.role_name === 'Staff')).toBe(true);
      expect(staff.body.data.users.length).toBeGreaterThan(0);
    });

    it('MGR-035: admin users list is unchanged', async () => {
      const res = await request(app)
        .get('/api/users?limit=100')
        .set(await adminAuth());
      expectEnvelope(res, 200);
      const roles = res.body.data.users.map((user) => user.role_id.role_name);
      expect(roles).toEqual(expect.arrayContaining(['Root', 'Admin', 'Manager']));
    });
  });

  describe('scope', () => {
    it('MGR-020: can_manage_roles does not widen manager shop access', async () => {
      const res = await request(app).get('/api/shops?limit=100').set(auth);
      expectEnvelope(res, 200);
      const names = res.body.data.shops.map((shop) => shop.name);
      expect(names).toEqual(expect.arrayContaining(['Main Branch', 'East Branch']));
      expect(names).not.toContain('North Branch');
    });

    it('MGR-021: manager can reach adjust-hours endpoints for own shop, not others', async () => {
      const query = { from_date: '2026-03-16', to_date: '2026-03-22' };
      const own = await request(app)
        .get('/api/attendance/adjust-hours/unchanged-users')
        .set(auth)
        .query({ ...query, shop_id: fixtures.shops.mainShop._id.toString() });
      expectEnvelope(own, 200);

      const other = await request(app)
        .get('/api/attendance/adjust-hours/unchanged-users')
        .set(auth)
        .query({ ...query, shop_id: outsideShop._id.toString() });
      expectEnvelope(other, 403);
    });
  });
});
