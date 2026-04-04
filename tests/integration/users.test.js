const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('Users module integration', () => {
  let fixtures;

  beforeAll(async () => {
    await connectSandboxDb();
  });

  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await disconnectSandboxDb();
  });

  it('USER-001: allows privileged role to list users', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.count).toBeGreaterThan(0);
    expect(Array.isArray(res.body.data.users)).toBe(true);
  });

  it('USER-002: staff user list is self-scoped', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${staffLogin.token}`);

    expectEnvelope(res, 200);
    expect(Array.isArray(res.body.data.users)).toBe(true);
    expect(res.body.data.users.length).toBe(1);
    expect(res.body.data.users[0]._id).toBe(fixtures.users.staffUser._id.toString());
  });

  it('USER-005: allows admin to create user', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        name: 'New Employee',
        email: 'new.employee@org.com',
        phone_code: '+44',
        phone_num: '7000000099',
        password: 'NewEmp@1234',
        role_id: fixtures.roles.staffRole._id.toString(),
        shop_id: fixtures.shops.mainShop._id.toString(),
      });

    expectEnvelope(res, 201);
    expect(res.body.data.user.must_change_password).toBe(true);
    expect(res.body.data.user.active_shop_id.toString()).toBe(
      fixtures.shops.mainShop._id.toString()
    );
    expect(res.body.data.user.assigned_shop_ids.map(String)).toContain(
      fixtures.shops.mainShop._id.toString()
    );
  });

  it('USER-007: blocks create user without can_create_users permission', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({
        name: 'No Access',
        email: 'no.access@org.com',
        password: 'NoAccess@1234',
        role_id: fixtures.roles.staffRole._id.toString(),
      });

    expectEnvelope(res, 403);
  });

  it('USER-006: rejects duplicate email on create', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        name: 'Another Root',
        email: 'root@org.com',
        password: 'RootAgain@1234',
        role_id: fixtures.roles.staffRole._id.toString(),
      });

    expectEnvelope(res, 400);
  });

  it('USER-003: gets single user by id for privileged role', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const res = await request(app)
      .get(`/api/users/${fixtures.users.staffUser._id}`)
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.user.email).toBe('staff@org.com');
  });

  it('USER-004: returns not found for unknown user id', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const res = await request(app)
      .get('/api/users/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(res, 404);
  });

  it('USER-008: updates user details', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const res = await request(app)
      .put(`/api/users/${fixtures.users.staffUser._id}`)
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        name: 'Dave Updated',
        email: 'staff.updated@org.com',
        role_id: fixtures.roles.staffRole._id.toString(),
      });

    expectEnvelope(res, 200);
    expect(res.body.data.user.name).toBe('Dave Updated');
  });

  it('USER-012: changing active shop appends previous active shop to history', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const res = await request(app)
      .put(`/api/users/${fixtures.users.staffUser._id}`)
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        active_shop_id: fixtures.shops.eastShop._id.toString(),
        assigned_shop_ids: [
          fixtures.shops.mainShop._id.toString(),
          fixtures.shops.eastShop._id.toString(),
        ],
      });

    expectEnvelope(res, 200);

    const updated = await User.findById(fixtures.users.staffUser._id);
    expect(updated.active_shop_id.toString()).toBe(fixtures.shops.eastShop._id.toString());
    expect(updated.shop_id.toString()).toBe(fixtures.shops.eastShop._id.toString());
    expect(Array.isArray(updated.shop_history)).toBe(true);
    expect(updated.shop_history.length).toBeGreaterThan(0);
    expect(updated.shop_history[updated.shop_history.length - 1].shop_id.toString()).toBe(
      fixtures.shops.mainShop._id.toString()
    );
  });

  it('USER-009: returns not found when updating unknown user', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const res = await request(app)
      .put('/api/users/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ name: 'Missing User' });

    expectEnvelope(res, 404);
  });

  it('USER-010 and USER-011: deactivates user and blocks subsequent login', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const deactivateRes = await request(app)
      .delete(`/api/users/${fixtures.users.staffUser._id}`)
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(deactivateRes, 200);
    expect(deactivateRes.body.data.user.is_active).toBe(false);

    const stored = await User.findById(fixtures.users.staffUser._id);
    expect(stored.is_active).toBe(false);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@org.com', password: 'Staff@1234' });
    expectEnvelope(loginRes, 400);
  });

  it('SEC-003: staff cannot read another user profile (scoped not found)', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const res = await request(app)
      .get(`/api/users/${fixtures.users.managerUser._id}`)
      .set('Authorization', `Bearer ${staffLogin.token}`);

    expectEnvelope(res, 404);
  });

  it('USER summary: manager can read assigned-shops staff summary and staff is forbidden', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const allowedRes = await request(app)
      .get('/api/users/assigned-shops/staff-summary')
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(allowedRes, 200);
    expect(Array.isArray(allowedRes.body.data.shops)).toBe(true);

    const forbiddenRes = await request(app)
      .get('/api/users/assigned-shops/staff-summary')
      .set('Authorization', `Bearer ${staffLogin.token}`);
    expectEnvelope(forbiddenRes, 403);
  });

  it('USER-015: manager can fetch shop users excluding Root and Admin roles', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const res = await request(app)
      .get(`/api/users/by-shop/${fixtures.shops.mainShop._id}/staff`)
      .set('Authorization', `Bearer ${managerLogin.token}`);

    expectEnvelope(res, 200);
    expect(Array.isArray(res.body.data.users)).toBe(true);
    const roleNames = res.body.data.users.map((user) => user.role_id?.role_name).filter(Boolean);
    expect(roleNames).not.toContain('Root');
    expect(roleNames).not.toContain('Admin');
  });

  it('SEC-001: rejects protected endpoint without token', async () => {
    const res = await request(app).get('/api/users');
    expectEnvelope(res, 401);
  });

  it('USER-013: user can register own device after login', async () => {
    await User.findByIdAndUpdate(fixtures.users.staffUser._id, { device_id: null });
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const res = await request(app)
      .put('/api/users/me/device')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({ device_id: 'staff-device-new-01' });

    expectEnvelope(res, 200);
    expect(res.body.data.user.device_id).toBe('staff-device-new-01');

    const stored = await User.findById(fixtures.users.staffUser._id);
    expect(stored.device_id).toBe('staff-device-new-01');
  });

  it('USER-014: admin can reset user password via update user', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const updateRes = await request(app)
      .put(`/api/users/${fixtures.users.staffUser._id}`)
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ password: 'Staff@5678' });

    expectEnvelope(updateRes, 200);
    expect(updateRes.body.data.user.must_change_password).toBe(true);

    const oldLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@org.com', password: 'Staff@1234' });
    expectEnvelope(oldLoginRes, 400);

    const newLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@org.com', password: 'Staff@5678' });
    expectEnvelope(newLoginRes, 200);
    expect(newLoginRes.body.data.must_change_password).toBe(true);
  });
});
