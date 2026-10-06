/**
 * Punch-in at a secondary (assigned) shop while the client still sends the
 * user's active shop_id — eligible-rotas, verify-location and punch-in must all
 * follow the shop the shift is actually at.
 */
const request = require('supertest');
const app = require('../../src/app');
const Rota = require('../../src/models/Rota');
const User = require('../../src/models/User');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('Attendance — shift at a secondary shop', () => {
  let fixtures;
  let mainShop;
  let eastShop;
  let rota;
  let auth;

  beforeAll(async () => {
    await connectSandboxDb();
  });

  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();
    mainShop = fixtures.shops.mainShop;
    eastShop = fixtures.shops.eastShop;

    // Active shop = Main, East assigned as a secondary shop.
    await User.updateOne(
      { _id: fixtures.users.staffUser._id },
      {
        active_shop_id: mainShop._id,
        shop_id: mainShop._id,
        assigned_shop_ids: [mainShop._id, eastShop._id],
      }
    );

    const now = Date.now();
    rota = await Rota.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: eastShop._id,
      shift_start: new Date(now - 30 * 60 * 1000),
      shift_end: new Date(now + 4 * 60 * 60 * 1000),
    });

    const { token } = await login('staff@org.com', 'Staff@1234');
    auth = { Authorization: `Bearer ${token}` };
  });

  afterAll(async () => {
    await disconnectSandboxDb();
  });

  const atEast = () => ({ latitude: eastShop.latitude, longitude: eastShop.longitude });

  it('eligible-rotas finds the secondary-shop shift when given the active shop', async () => {
    const res = await request(app)
      .get('/api/attendance/eligible-rotas')
      .query({ shop_id: mainShop._id.toString() })
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.rotas[0]._id).toBe(rota._id.toString());
    expect(res.body.data.rotas[0].shop).toEqual({
      _id: eastShop._id.toString(),
      name: 'East Branch',
    });
  });

  it('eligible-rotas works without shop_id', async () => {
    const res = await request(app).get('/api/attendance/eligible-rotas').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
  });

  it('verify-location checks the geofence of the shift shop, then punch-in succeeds', async () => {
    const verify = await request(app)
      .post('/api/attendance/verify-location')
      .set(auth)
      .send({ shop_id: mainShop._id.toString(), ...atEast() });

    expect(verify.status).toBe(200);
    expect(verify.body.data.shop_id).toBe(eastShop._id.toString());

    const punch = await request(app).post('/api/attendance/punch-in').set(auth).send({
      shop_id: mainShop._id.toString(), // client still sends the active shop
      location_token: verify.body.data.location_token,
      biometric_verified: true,
    });

    expect(punch.status).toBe(201);
    expect(punch.body.data.attendance.shop_id).toBe(eastShop._id.toString());
    expect(punch.body.data.attendance.rota_id._id).toBe(rota._id.toString());
  });

  it('verify-location uses the selected rota shop when rota_id is sent', async () => {
    const verify = await request(app)
      .post('/api/attendance/verify-location')
      .set(auth)
      .send({ shop_id: mainShop._id.toString(), rota_id: rota._id.toString(), ...atEast() });

    expect(verify.status).toBe(200);
    expect(verify.body.data.shop_id).toBe(eastShop._id.toString());
  });

  it('rejects standing at the active shop when the shift is at the secondary shop', async () => {
    const verify = await request(app).post('/api/attendance/verify-location').set(auth).send({
      shop_id: mainShop._id.toString(),
      latitude: mainShop.latitude,
      longitude: mainShop.longitude,
    });

    expect(verify.status).toBe(403);
    expect(verify.body.message).toMatch(/East Branch/);
  });
});
