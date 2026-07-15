/**
 * Shop is_active / is_all_shops flag integration tests.
 *
 * These fields are additive: they appear in every shop response and can be set
 * on create/update, but the GET /api/shops listing is intentionally NOT filtered
 * by them (current flow unchanged).
 */
const request = require('supertest');
const app = require('../../src/app');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('Shop is_active / is_all_shops flags', () => {
  let fixtures;
  let adminToken;

  beforeAll(async () => {
    await connectSandboxDb();
  });
  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    adminToken = adminLogin.token;
  });
  afterAll(async () => {
    await disconnectSandboxDb();
  });

  it('defaults existing shops to is_active=true and is_all_shops=false', async () => {
    const res = await request(app)
      .get(`/api/shops/${fixtures.shops.mainShop._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expectEnvelope(res, 200);
    expect(res.body.data.shop.is_active).toBe(true);
    expect(res.body.data.shop.is_all_shops).toBe(false);
  });

  it('list endpoint returns the flags on every shop and is not filtered by them', async () => {
    const res = await request(app)
      .get('/api/shops')
      .set('Authorization', `Bearer ${adminToken}`);
    expectEnvelope(res, 200);
    expect(res.body.data.shops.length).toBeGreaterThanOrEqual(2);
    res.body.data.shops.forEach((s) => {
      expect(typeof s.is_active).toBe('boolean');
      expect(typeof s.is_all_shops).toBe('boolean');
    });
  });

  it('can create a closed (is_active=false) shop and flag an aggregate (is_all_shops=true)', async () => {
    const res = await request(app)
      .post('/api/shops')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'All Shops',
        latitude: 51.5,
        longitude: -0.12,
        is_active: false,
        is_all_shops: true,
      });
    expectEnvelope(res, 201);
    expect(res.body.data.shop.is_active).toBe(false);
    expect(res.body.data.shop.is_all_shops).toBe(true);
  });

  it('can mark an existing shop closed via update (is_active=false)', async () => {
    const res = await request(app)
      .put(`/api/shops/${fixtures.shops.mainShop._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });
    expectEnvelope(res, 200);
    expect(res.body.data.shop.is_active).toBe(false);

    // still listed — not filtered out
    const list = await request(app)
      .get('/api/shops')
      .set('Authorization', `Bearer ${adminToken}`);
    const ids = list.body.data.shops.map((s) => String(s._id));
    expect(ids).toContain(String(fixtures.shops.mainShop._id));
  });
});
