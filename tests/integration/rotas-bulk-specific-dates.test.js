const request = require('supertest');
const app = require('../../src/app');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('Rota bulk create with specific dates', () => {
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

  it('should apply assignments with specific ISO dates only to matching days', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const res = await request(app)
      .post('/api/rotas/bulk')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        week_start: '2026-03-23',
        days: [0, 1, 2, 3, 4, 5, 6], // All 7 days
        replace_existing: false,
        assignments: [
          {
            user_id: fixtures.users.staffUser._id.toString(),
            start_time: '2026-03-23T09:00:00.000Z',
            end_time: '2026-03-23T17:00:00.000Z',
            note: 'Monday only',
          },
          {
            user_id: fixtures.users.staffUser._id.toString(),
            start_time: '2026-03-24T09:00:00.000Z',
            end_time: '2026-03-24T17:00:00.000Z',
            note: 'Tuesday only',
          },
        ],
      });

    expectEnvelope(res, 201);
    // Should create exactly 2 rotas (one for Monday, one for Tuesday)
    // Not 14 (7 days × 2 assignments)
    expect(res.body.data.created).toBe(2);
    expect(res.body.data.skipped).toBe(0);
    expect(res.body.data.conflicts.length).toBe(0);
  });

  it('should apply time-pattern assignments to all days', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const res = await request(app)
      .post('/api/rotas/bulk')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        week_start: '2026-03-23',
        days: [0, 1, 2], // Mon, Tue, Wed
        replace_existing: false,
        assignments: [
          {
            user_id: fixtures.users.staffUser._id.toString(),
            start_time: '09:00',
            end_time: '17:00',
            note: 'Pattern: all selected days',
          },
        ],
      });

    expectEnvelope(res, 201);
    // Should create 3 rotas (one for each selected day)
    expect(res.body.data.created).toBe(3);
    expect(res.body.data.skipped).toBe(0);
  });

  it('should mix specific dates and time patterns', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const res = await request(app)
      .post('/api/rotas/bulk')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        week_start: '2026-03-23',
        days: [0, 1, 2, 3, 4, 5, 6],
        replace_existing: false,
        assignments: [
          {
            user_id: fixtures.users.staffUser._id.toString(),
            start_time: '2026-03-23T09:00:00.000Z', // Monday only
            end_time: '2026-03-23T17:00:00.000Z',
          },
          {
            user_id: fixtures.users.managerUser._id.toString(),
            start_time: '14:00', // All 7 days
            end_time: '22:00',
          },
        ],
      });

    expectEnvelope(res, 201);
    // 1 (staff Mon) + 7 (manager all days) = 8
    expect(res.body.data.created).toBe(8);
    expect(res.body.data.skipped).toBe(0);
  });

  it('should return 400 when specific date falls outside the week (no silent failure)', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    // week_start: Sunday May 17 → resolves to week Mon May 11 – Sun May 17
    // start_time:  Saturday May 23 → outside that week
    const res = await request(app)
      .post('/api/rotas/bulk')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        week_start: '2026-05-17',
        days: [0, 1, 2, 3, 4, 5, 6],
        replace_existing: false,
        assignments: [
          {
            user_id: fixtures.users.staffUser._id.toString(),
            start_time: '2026-05-23T21:00:00.000Z',
            end_time: '2026-05-24T03:00:00.000Z',
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.data.error_code).toBe('ASSIGNMENT_DATE_OUTSIDE_WEEK');
    expect(res.body.data.week_start).toBe('2026-05-11');
    expect(res.body.data.week_end).toBe('2026-05-17');
    expect(res.body.data.out_of_range[0].provided_date).toBe('2026-05-23');
  });
});
