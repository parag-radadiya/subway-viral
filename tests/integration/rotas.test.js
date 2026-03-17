const request = require('supertest');
const app = require('../../src/app');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const Rota = require('../../src/models/Rota');
const Shop = require('../../src/models/Shop');
const User = require('../../src/models/User');
const {
  connectSandboxDb,
  clearSandboxDb,
  disconnectSandboxDb,
} = require('../setup/testDb');

describe('Rota module integration', () => {
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

  it('ROTA-006: manager creates bulk rota successfully', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const res = await request(app)
      .post('/api/rotas/bulk')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        week_start: '2026-03-16',
        days: [0, 1],
        assignments: [
          {
            user_id: fixtures.users.staffUser._id.toString(),
            start_time: '08:00',
            end_time: '16:00',
          },
        ],
      });

    expectEnvelope(res, 201);
    expect(res.body.data.created).toBeGreaterThan(0);
  });

  it('ROTA-001 and ROTA-002: lists rotas and fetches a single rota', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const listRes = await request(app)
      .get('/api/rotas')
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(listRes, 200);
    expect(Array.isArray(listRes.body.data.rotas)).toBe(true);

    const rotaId = listRes.body.data.rotas[0]._id;
    const singleRes = await request(app)
      .get(`/api/rotas/${rotaId}`)
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(singleRes, 200);
  });

  it('ROTA-003 and ROTA-005: allows manager create and blocks staff create', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const createRes = await request(app)
      .post('/api/rotas')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        user_id: fixtures.users.staffUser._id.toString(),
        shop_id: fixtures.shops.mainShop._id.toString(),
        shift_date: '2026-03-19',
        start_time: '11:00',
        end_time: '18:00',
      });
    expectEnvelope(createRes, 201);

    const blockedRes = await request(app)
      .post('/api/rotas')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({
        user_id: fixtures.users.staffUser._id.toString(),
        shop_id: fixtures.shops.mainShop._id.toString(),
        shift_date: '2026-03-20',
        start_time: '11:00',
      });
    expectEnvelope(blockedRes, 403);
  });

  it('ROTA-004: rejects duplicate single rota entries', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const payload = {
      user_id: fixtures.users.staffUser._id.toString(),
      shop_id: fixtures.shops.mainShop._id.toString(),
      shift_date: '2026-03-22',
      start_time: '09:00',
      end_time: '17:00',
    };

    const firstRes = await request(app)
      .post('/api/rotas')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send(payload);
    expectEnvelope(firstRes, 201);

    const duplicateRes = await request(app)
      .post('/api/rotas')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send(payload);
    expectEnvelope(duplicateRes, 409);
  });

  it('ROTA-008: rejects invalid day values in bulk rota', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const res = await request(app)
      .post('/api/rotas/bulk')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        week_start: '2026-03-16',
        days: [7],
        assignments: [
          {
            user_id: fixtures.users.staffUser._id.toString(),
            start_time: '08:00',
          },
        ],
      });

    expectEnvelope(res, 400);
  });

  it('ROTA-013: blocks employee from dashboard endpoint', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const res = await request(app)
      .get('/api/rotas/dashboard?week_start=2026-03-16')
      .set('Authorization', `Bearer ${staffLogin.token}`);

    expectEnvelope(res, 403);
  });

  it('ROTA-012: allows manager dashboard endpoint', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const res = await request(app)
      .get('/api/rotas/dashboard?week_start=2026-03-16')
      .set('Authorization', `Bearer ${managerLogin.token}`);

    expectEnvelope(res, 200);
    expect(Array.isArray(res.body.data.by_shop)).toBe(true);
    expect(Array.isArray(res.body.data.by_employee)).toBe(true);
  });

  it('ROTA-009 and ROTA-010: returns week view and validates missing week_start', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const okRes = await request(app)
      .get('/api/rotas/week?week_start=2026-03-16')
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(okRes, 200);

    const badRes = await request(app)
      .get('/api/rotas/week')
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(badRes, 400);
  });

  it('ROTA-011: clears week rota for manager', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const res = await request(app)
      .delete('/api/rotas/week?week_start=2026-03-16')
      .set('Authorization', `Bearer ${managerLogin.token}`);

    expectEnvelope(res, 200);
    expect(typeof res.body.data.deleted).toBe('number');
  });

  it('ROTA-007: bulk create returns conflicts when duplicates exist', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const firstRes = await request(app)
      .post('/api/rotas/bulk')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        week_start: '2026-03-24',
        days: [0],
        assignments: [{
          user_id: fixtures.users.staffUser._id.toString(),
          start_time: '09:30',
          end_time: '17:30',
        }],
      });
    expectEnvelope(firstRes, 201);

    const duplicateRes = await request(app)
      .post('/api/rotas/bulk')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        week_start: '2026-03-24',
        days: [0],
        assignments: [{
          user_id: fixtures.users.staffUser._id.toString(),
          start_time: '09:30',
          end_time: '17:30',
        }],
      });

    expectEnvelope(duplicateRes, 201);
    expect(duplicateRes.body.data.skipped).toBeGreaterThan(0);
    expect(Array.isArray(duplicateRes.body.data.conflicts)).toBe(true);
  });

  it('ROTA-014: staff list is self-scoped even if another user_id is provided', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    await request(app)
      .post('/api/rotas')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        user_id: fixtures.users.managerUser._id.toString(),
        shop_id: fixtures.shops.mainShop._id.toString(),
        shift_date: '2026-03-21',
        start_time: '12:00',
        end_time: '18:00',
      });

    const staffLogin = await login('staff@org.com', 'Staff@1234');
    const res = await request(app)
      .get(`/api/rotas?user_id=${fixtures.users.managerUser._id}`)
      .set('Authorization', `Bearer ${staffLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.rotas.length).toBeGreaterThan(0);
    res.body.data.rotas.forEach((rota) => {
      expect(rota.user_id._id).toBe(fixtures.users.staffUser._id.toString());
    });
  });

  it('ROTA-015: staff cannot fetch another user rota by id', async () => {
    const managerRota = await Rota.create({
      user_id: fixtures.users.managerUser._id,
      shop_id: fixtures.shops.mainShop._id,
      shift_date: new Date('2026-03-22T00:00:00.000Z'),
      start_time: '13:00',
      end_time: '20:00',
    });

    const staffLogin = await login('staff@org.com', 'Staff@1234');
    const res = await request(app)
      .get(`/api/rotas/${managerRota._id}`)
      .set('Authorization', `Bearer ${staffLogin.token}`);

    expectEnvelope(res, 404);
  });

  it('ROTA-016: manager reads only assigned-shop rota data', async () => {
    const remoteShop = await Shop.create({
      name: 'North Branch',
      latitude: 52.0,
      longitude: -0.1,
      geofence_radius_m: 100,
    });

    await User.findByIdAndUpdate(fixtures.users.managerUser._id, {
      assigned_shop_ids: [fixtures.shops.mainShop._id],
      shop_id: fixtures.shops.mainShop._id,
    });

    await Rota.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: remoteShop._id,
      shift_date: new Date('2026-03-18T00:00:00.000Z'),
      start_time: '07:00',
      end_time: '11:00',
    });

    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const listRes = await request(app)
      .get('/api/rotas')
      .set('Authorization', `Bearer ${managerLogin.token}`);

    expectEnvelope(listRes, 200);
    expect(listRes.body.data.rotas.some((rota) => rota.shop_id._id === remoteShop._id.toString())).toBe(false);

    const weekRes = await request(app)
      .get(`/api/rotas/week?week_start=2026-03-16&shop_id=${remoteShop._id}`)
      .set('Authorization', `Bearer ${managerLogin.token}`);

    expectEnvelope(weekRes, 200);
    const dayValues = Object.values(weekRes.body.data.days || {});
    expect(dayValues.every((entries) => entries.length === 0)).toBe(true);
  });

  it('ROTA-017: manager cannot create rota in an unassigned shop', async () => {
    const remoteShop = await Shop.create({
      name: 'South Branch',
      latitude: 52.2,
      longitude: -0.2,
      geofence_radius_m: 120,
    });

    await User.findByIdAndUpdate(fixtures.users.managerUser._id, {
      assigned_shop_ids: [fixtures.shops.mainShop._id],
      shop_id: fixtures.shops.mainShop._id,
    });

    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const res = await request(app)
      .post('/api/rotas')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        user_id: fixtures.users.staffUser._id.toString(),
        shop_id: remoteShop._id.toString(),
        shift_date: '2026-03-25',
        start_time: '10:00',
        end_time: '16:00',
      });

    expectEnvelope(res, 403);
  });

  it('ROTA-018: manager cannot update or delete rota in an unassigned shop', async () => {
    const remoteShop = await Shop.create({
      name: 'West Branch',
      latitude: 52.4,
      longitude: -0.4,
      geofence_radius_m: 120,
    });

    await User.findByIdAndUpdate(fixtures.users.managerUser._id, {
      assigned_shop_ids: [fixtures.shops.mainShop._id],
      shop_id: fixtures.shops.mainShop._id,
    });

    const remoteRota = await Rota.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: remoteShop._id,
      shift_date: new Date('2026-03-26T00:00:00.000Z'),
      start_time: '09:00',
      end_time: '17:00',
    });

    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const updateRes = await request(app)
      .put(`/api/rotas/${remoteRota._id}`)
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ end_time: '18:00' });
    expectEnvelope(updateRes, 403);

    const deleteRes = await request(app)
      .delete(`/api/rotas/${remoteRota._id}`)
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(deleteRes, 403);
  });

  it('ROTA-019: clear week without shop_id only clears manager assigned shops', async () => {
    const remoteShop = await Shop.create({
      name: 'Central Branch',
      latitude: 52.5,
      longitude: -0.5,
      geofence_radius_m: 120,
    });

    await User.findByIdAndUpdate(fixtures.users.managerUser._id, {
      assigned_shop_ids: [fixtures.shops.mainShop._id],
      shop_id: fixtures.shops.mainShop._id,
    });

    await Rota.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: remoteShop._id,
      shift_date: new Date('2026-03-16T00:00:00.000Z'),
      start_time: '08:00',
      end_time: '12:00',
    });

    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const clearRes = await request(app)
      .delete('/api/rotas/week?week_start=2026-03-16')
      .set('Authorization', `Bearer ${managerLogin.token}`);

    expectEnvelope(clearRes, 200);

    const mainWeekCount = await Rota.countDocuments({
      shop_id: fixtures.shops.mainShop._id,
      shift_date: {
        $gte: new Date('2026-03-16T00:00:00.000Z'),
        $lte: new Date('2026-03-22T23:59:59.999Z'),
      },
    });

    const remoteWeekCount = await Rota.countDocuments({
      shop_id: remoteShop._id,
      shift_date: {
        $gte: new Date('2026-03-16T00:00:00.000Z'),
        $lte: new Date('2026-03-22T23:59:59.999Z'),
      },
    });

    expect(mainWeekCount).toBe(0);
    expect(remoteWeekCount).toBe(1);
  });

  it('ROTA-020: manager can create rota using merged shift_start/shift_end datetime keys', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const res = await request(app)
      .post('/api/rotas')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        user_id: fixtures.users.staffUser._id.toString(),
        shop_id: fixtures.shops.mainShop._id.toString(),
        shift_start: '2026-03-28T09:00:00.000Z',
        shift_end: '2026-03-28T17:00:00.000Z',
      });

    expectEnvelope(res, 201);
    expect(res.body.data.rota.shift_start).toBeTruthy();
    expect(res.body.data.rota.shift_end).toBeTruthy();
    expect(res.body.data.rota.start_time).toBe('09:00');
    expect(res.body.data.rota.end_time).toBe('17:00');
  });
});


