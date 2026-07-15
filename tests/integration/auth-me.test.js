/**
 * GET /api/auth/me — returns the current user (from the Bearer token) in the
 * same shape as the login response's `user` object.
 */
const request = require('supertest');
const app = require('../../src/app');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('GET /api/auth/me', () => {
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

  it('returns the current user matching the login user shape', async () => {
    const loginRes = await login('admin@org.com', 'Admin@1234');
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginRes.token}`);

    expectEnvelope(meRes, 200);
    const me = meRes.body.data.user;

    // same keys as the login payload's user object
    expect(Object.keys(me).sort()).toEqual(
      ['id', 'name', 'email', 'role', 'active_shop_id', 'shop_id', 'assigned_shop_ids'].sort()
    );
    expect(String(me.id)).toBe(String(fixtures.users.adminUser._id));
    expect(me.email).toBe('admin@org.com');
    expect(me.name).toBe('Alice Admin');
    // role is the fully populated role document
    expect(me.role.role_name).toBe('Admin');
    expect(me.role.permissions.can_manage_shops).toBe(true);
    // identical to what login returned
    expect(String(me.id)).toBe(String(loginRes.user.id));
    expect(me.role.role_name).toBe(loginRes.user.role.role_name);
  });

  it('rejects requests without a token (401)', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token (401)', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
