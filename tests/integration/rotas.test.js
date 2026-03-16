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
});


