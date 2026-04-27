const request = require('supertest');
const app = require('../../src/app');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

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

  it('SHOP-007: admin can update shop hours and read shop hours history', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const updateRes = await request(app)
      .put(`/api/shops/${fixtures.shops.mainShop._id}/hours`)
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        opening_time: '09:00',
        closing_time: '21:00',
        note: 'Summer timing',
      });

    expectEnvelope(updateRes, 200);
    expect(updateRes.body.data.shop.opening_time).toBe('09:00');
    expect(updateRes.body.data.shop.closing_time).toBe('21:00');

    const historyRes = await request(app)
      .get(`/api/shops/${fixtures.shops.mainShop._id}/hours-history`)
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(historyRes, 200);
    expect(historyRes.body.data.count).toBeGreaterThan(0);
    expect(Array.isArray(historyRes.body.data.history)).toBe(true);
  });

  it('SHOP-009: admin can set shift caps and overnight operating hours', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const updateCapsRes = await request(app)
      .put(`/api/shops/${fixtures.shops.mainShop._id}`)
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        min_shift_duration_hours: 2,
        max_shift_duration_hours: 8,
      });

    expectEnvelope(updateCapsRes, 200);
    expect(updateCapsRes.body.data.shop.min_shift_duration_hours).toBe(2);
    expect(updateCapsRes.body.data.shop.max_shift_duration_hours).toBe(8);

    const overnightRes = await request(app)
      .put(`/api/shops/${fixtures.shops.mainShop._id}/hours`)
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        opening_time: '07:00',
        closing_time: '05:00',
        note: 'Overnight schedule',
      });

    expectEnvelope(overnightRes, 200);
    expect(overnightRes.body.data.shop.opening_time).toBe('07:00');
    expect(overnightRes.body.data.shop.closing_time).toBe('05:00');
  });

  it('SHOP-008: staff cannot update or read shop-hours history', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const updateRes = await request(app)
      .put(`/api/shops/${fixtures.shops.mainShop._id}/hours`)
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({
        opening_time: '09:00',
        closing_time: '21:00',
      });
    expectEnvelope(updateRes, 403);

    const historyRes = await request(app)
      .get(`/api/shops/${fixtures.shops.mainShop._id}/hours-history`)
      .set('Authorization', `Bearer ${staffLogin.token}`);
    expectEnvelope(historyRes, 403);
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

  it('SHOP scope: staff sees only assigned shops and cannot read unassigned shop', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const listRes = await request(app)
      .get('/api/shops')
      .set('Authorization', `Bearer ${staffLogin.token}`);

    expectEnvelope(listRes, 200);
    expect(Array.isArray(listRes.body.data.shops)).toBe(true);
    expect(listRes.body.data.shops.length).toBe(1);
    expect(listRes.body.data.shops[0]._id).toBe(fixtures.shops.mainShop._id.toString());

    const blockedRes = await request(app)
      .get(`/api/shops/${fixtures.shops.eastShop._id}`)
      .set('Authorization', `Bearer ${staffLogin.token}`);

    expectEnvelope(blockedRes, 404);
  });
});
