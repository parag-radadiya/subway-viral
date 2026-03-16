const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const {
  connectSandboxDb,
  clearSandboxDb,
  disconnectSandboxDb,
} = require('../setup/testDb');

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

  it('USER-002: blocks employee from listing users', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${staffLogin.token}`);

    expectEnvelope(res, 403);
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
    expectEnvelope(loginRes, 401);
  });

  it('SEC-003: blocks employee from reading another user profile', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const res = await request(app)
      .get(`/api/users/${fixtures.users.managerUser._id}`)
      .set('Authorization', `Bearer ${staffLogin.token}`);

    expectEnvelope(res, 403);
  });

  it('SEC-001: rejects protected endpoint without token', async () => {
    const res = await request(app).get('/api/users');
    expectEnvelope(res, 401);
  });
});


