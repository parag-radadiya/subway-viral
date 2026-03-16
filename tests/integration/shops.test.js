const request = require('supertest');
const app = require('../../src/app');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const {
  connectSandboxDb,
  clearSandboxDb,
  disconnectSandboxDb,
} = require('../setup/testDb');

describe('Shops module integration', () => {
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

  it('SHOP-001 and SHOP-002: lists shops and gets a single shop', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const listRes = await request(app)
      .get('/api/shops')
      .set('Authorization', `Bearer ${staffLogin.token}`);
    expectEnvelope(listRes, 200);
    expect(Array.isArray(listRes.body.data.shops)).toBe(true);

    const getRes = await request(app)
      .get(`/api/shops/${fixtures.shops.mainShop._id}`)
      .set('Authorization', `Bearer ${staffLogin.token}`);
    expectEnvelope(getRes, 200);
  });

  it('SHOP-003 and SHOP-004: allows admin create shop and blocks staff', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const createRes = await request(app)
      .post('/api/shops')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        name: 'North Branch',
        latitude: 51.52,
        longitude: -0.13,
        geofence_radius_m: 120,
      });
    expectEnvelope(createRes, 201);

    const blockedRes = await request(app)
      .post('/api/shops')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({ name: 'NoAccess Shop', latitude: 0, longitude: 0 });
    expectEnvelope(blockedRes, 403);
  });

  it('SHOP-005 and SHOP-006: updates and deletes shop with permission', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const updateRes = await request(app)
      .put(`/api/shops/${fixtures.shops.eastShop._id}`)
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ geofence_radius_m: 250 });
    expectEnvelope(updateRes, 200);
    expect(updateRes.body.data.shop.geofence_radius_m).toBe(250);

    const deleteRes = await request(app)
      .delete(`/api/shops/${fixtures.shops.eastShop._id}`)
      .set('Authorization', `Bearer ${adminLogin.token}`);
    expectEnvelope(deleteRes, 200);
  });

  it('SHOP exceptions: returns not found for missing shop id on get/update/delete', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const missingId = '507f1f77bcf86cd799439011';

    const getRes = await request(app)
      .get(`/api/shops/${missingId}`)
      .set('Authorization', `Bearer ${adminLogin.token}`);
    expectEnvelope(getRes, 404);

    const updateRes = await request(app)
      .put(`/api/shops/${missingId}`)
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ name: 'Missing' });
    expectEnvelope(updateRes, 404);

    const deleteRes = await request(app)
      .delete(`/api/shops/${missingId}`)
      .set('Authorization', `Bearer ${adminLogin.token}`);
    expectEnvelope(deleteRes, 404);
  });
});

