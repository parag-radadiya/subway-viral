const request = require('supertest');
const app = require('../../src/app');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

function nextMonday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const dow = d.getUTCDay();
  const daysUntilMon = dow === 0 ? 1 : dow === 1 ? 7 : 8 - dow;
  d.setUTCDate(d.getUTCDate() + daysUntilMon);
  return d;
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

describe('Rota bulk create with specific dates', () => {
  let fixtures;
  let futureMonday;
  let futureMondayStr;

  beforeAll(async () => {
    await connectSandboxDb();
  });

  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();
    futureMonday = nextMonday();
    futureMondayStr = fmtDate(futureMonday);
  });

  afterAll(async () => {
    await disconnectSandboxDb();
  });

  it('should apply assignments with specific ISO dates only to matching days', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const mon = futureMonday;
    const tue = addDays(mon, 1);

    const res = await request(app)
      .post('/api/rotas/bulk')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        week_start: futureMondayStr,
        days: [0, 1, 2, 3, 4, 5, 6],
        replace_existing: false,
        assignments: [
          {
            user_id: fixtures.users.staffUser._id.toString(),
            start_time: `${fmtDate(mon)}T09:00:00.000Z`,
            end_time: `${fmtDate(mon)}T17:00:00.000Z`,
            note: 'Monday only',
          },
          {
            user_id: fixtures.users.staffUser._id.toString(),
            start_time: `${fmtDate(tue)}T09:00:00.000Z`,
            end_time: `${fmtDate(tue)}T17:00:00.000Z`,
            note: 'Tuesday only',
          },
        ],
      });

    expectEnvelope(res, 201);
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
        week_start: futureMondayStr,
        days: [0, 1, 2],
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
    expect(res.body.data.created).toBe(3);
    expect(res.body.data.skipped).toBe(0);
  });

  it('should mix specific dates and time patterns', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const mon = futureMonday;

    const res = await request(app)
      .post('/api/rotas/bulk')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        week_start: futureMondayStr,
        days: [0, 1, 2, 3, 4, 5, 6],
        replace_existing: false,
        assignments: [
          {
            user_id: fixtures.users.staffUser._id.toString(),
            start_time: `${fmtDate(mon)}T09:00:00.000Z`,
            end_time: `${fmtDate(mon)}T17:00:00.000Z`,
          },
          {
            user_id: fixtures.users.managerUser._id.toString(),
            start_time: '14:00',
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

    // week_start resolves to futureMonday's week (Mon–Sun)
    // start_time uses a date 10 days later → outside that week
    const outOfRangeDate = addDays(futureMonday, 10);

    const res = await request(app)
      .post('/api/rotas/bulk')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        week_start: futureMondayStr,
        days: [0, 1, 2, 3, 4, 5, 6],
        replace_existing: false,
        assignments: [
          {
            user_id: fixtures.users.staffUser._id.toString(),
            start_time: `${fmtDate(outOfRangeDate)}T21:00:00.000Z`,
            end_time: `${fmtDate(addDays(outOfRangeDate, 1))}T03:00:00.000Z`,
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.data.error_code).toBe('ASSIGNMENT_DATE_OUTSIDE_WEEK');
    expect(res.body.data.week_start).toBe(futureMondayStr);
    expect(res.body.data.week_end).toBe(fmtDate(addDays(futureMonday, 6)));
    expect(res.body.data.out_of_range[0].provided_date).toBe(fmtDate(outOfRangeDate));
  });
});
