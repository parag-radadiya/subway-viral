const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const { expectEnvelope } = require('../helpers/assertions');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('Auth and onboarding integration', () => {
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

  it('AUTH-001: logs in successfully with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'root@org.com', password: 'Root@1234' });

    expectEnvelope(res, 200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.access_token).toBeTruthy();
    expect(res.body.data.refresh_token).toBeTruthy();
    expect(res.body.data.user.email).toBe('root@org.com');
    expect(res.body.data.user.active_shop_id).toBeTruthy();
    expect(res.body.data.needs_device_registration).toBe(false);
    expect(res.body.data.user.role.permissions.can_manage_roles).toBe(true);
  });

  it('AUTH-002: rejects missing login fields', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'root@org.com' });

    expectEnvelope(res, 400);
  });

  it('AUTH-003: rejects invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'root@org.com', password: 'Wrong@1234' });

    expectEnvelope(res, 400);
  });

  it('AUTH-004: blocks deactivated user login', async () => {
    await User.findByIdAndUpdate(fixtures.users.staffUser._id, { is_active: false });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@org.com', password: 'Staff@1234' });

    expectEnvelope(res, 400);
  });

  it('AUTH-006: updates password and clears must_change_password', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@org.com', password: 'Admin@1234' });

    expectEnvelope(loginRes, 200);
    expect(loginRes.body.data.must_change_password).toBe(true);

    const token = loginRes.body.data.token;
    const updateRes = await request(app)
      .put('/api/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Admin@1234', newPassword: 'Admin@1234_new', device_id: 'Test123' });

    expectEnvelope(updateRes, 200);

    const updatedUser = await User.findOne({ email: 'admin@org.com' });
    expect(updatedUser.must_change_password).toBe(false);

    const reloginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@org.com', password: 'Admin@1234_new' });

    expectEnvelope(reloginRes, 200);
    expect(reloginRes.body.data.must_change_password).toBe(false);
  });

  it('AUTH-007: blocks password update when current password is wrong', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'manager@org.com', password: 'Manager@1234' });

    const res = await request(app)
      .put('/api/users/me/password')
      .set('Authorization', `Bearer ${loginRes.body.data.token}`)
      .send({
        currentPassword: 'Wrong@1234',
        newPassword: 'Manager@1234_new',
        device_id: 'Test123',
      });

    expectEnvelope(res, 401);
  });

  it('AUTH-008: blocks password update with weak new password', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'manager@org.com', password: 'Manager@1234' });

    const res = await request(app)
      .put('/api/users/me/password')
      .set('Authorization', `Bearer ${loginRes.body.data.token}`)
      .send({ currentPassword: 'Manager@1234', newPassword: 'short', device_id: 'Test123' });

    expectEnvelope(res, 400);
  });

  it('SEC-002: rejects invalid JWT on protected route', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer not-a-valid-token');

    expectEnvelope(res, 401);
  });

  it('SEC-004: unknown route returns 404 envelope', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist');
    expectEnvelope(res, 404);
  });

  it('AUTH-009: refresh token rotates access and refresh tokens', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'manager@org.com', password: 'Manager@1234' });

    expectEnvelope(loginRes, 200);
    const previousRefresh = loginRes.body.data.refresh_token;

    const refreshRes = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refresh_token: previousRefresh });

    expectEnvelope(refreshRes, 200);
    expect(refreshRes.body.data.access_token).toBeTruthy();
    expect(refreshRes.body.data.refresh_token).toBeTruthy();
    expect(refreshRes.body.data.refresh_token).not.toBe(previousRefresh);
  });

  it('AUTH-010: logout revokes refresh token', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'manager@org.com', password: 'Manager@1234' });

    expectEnvelope(loginRes, 200);
    const refreshToken = loginRes.body.data.refresh_token;

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .send({ refresh_token: refreshToken });

    expectEnvelope(logoutRes, 200);

    const refreshAgain = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refresh_token: refreshToken });

    expectEnvelope(refreshAgain, 401);
  });
});
