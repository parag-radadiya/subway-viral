/**
 * Store report financial records — edit (PUT) + delete (DELETE) endpoints.
 *
 * Complements the existing GET + POST(upsert) for the Weekly 2026 and
 * Monthly Sale 2026 record families. Runs against in-memory MongoDB.
 */
const request = require('supertest');
const app = require('../../src/app');
const StoreReportWeekly2026B = require('../../src/models/StoreReportWeekly2026B');
const StoreReportMonthlySale2026 = require('../../src/models/StoreReportMonthlySale2026');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('Store report records — edit & delete', () => {
  let fixtures;
  let adminToken;

  async function createWeekly(overrides = {}) {
    const res = await request(app)
      .post('/api/store-reports/weekly')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        year: 2026,
        month: 1,
        week_number: 1,
        week_range_label: '29/12 to 04/01',
        metrics: { sales: 500, net: 410 },
        ...overrides,
      });
    expect(res.status).toBe(200);
    return res.body.data.record;
  }

  async function createMonthly(overrides = {}) {
    const res = await request(app)
      .post('/api/store-reports/monthly-sale')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        year: 2026,
        month: 1,
        metrics: { sales: 1000 },
        ...overrides,
      });
    expect(res.status).toBe(200);
    return res.body.data.record;
  }

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

  // ── Weekly ────────────────────────────────────────────────────────────────
  it('edits a weekly record (metrics + week_number) by id', async () => {
    const rec = await createWeekly();
    const res = await request(app)
      .put(`/api/store-reports/weekly/${rec._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ metrics: { sales: 999, net: 800 }, week_number: 2 });

    expectEnvelope(res, 200);
    expect(res.body.data.record.metrics.sales).toBe(999);
    expect(res.body.data.record.week_number).toBe(2);
    // period_key recomputed from the new week_number
    expect(res.body.data.record.period_key).toBe('2026-01-W02');

    const inDb = await StoreReportWeekly2026B.findById(rec._id);
    expect(inDb.metrics.sales).toBe(999);
    expect(inDb.week_number).toBe(2);
  });

  it('rejects a weekly edit that collides with another record (409)', async () => {
    const a = await createWeekly({ week_number: 1 });
    await createWeekly({ week_number: 2 });
    // try to move record A onto record B's identity (week_number 2)
    const res = await request(app)
      .put(`/api/store-reports/weekly/${a._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ week_number: 2 });
    expect(res.status).toBe(409);
  });

  it('rejects non-object metrics on weekly edit (400)', async () => {
    const rec = await createWeekly();
    const res = await request(app)
      .put(`/api/store-reports/weekly/${rec._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ metrics: 'not-an-object' });
    expect(res.status).toBe(400);
  });

  it('deletes a weekly record by id', async () => {
    const rec = await createWeekly();
    const res = await request(app)
      .delete(`/api/store-reports/weekly/${rec._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expectEnvelope(res, 200);
    expect(await StoreReportWeekly2026B.findById(rec._id)).toBeNull();
  });

  it('returns 404 deleting a missing weekly record', async () => {
    const res = await request(app)
      .delete('/api/store-reports/weekly/69f4c6243a7e3e41d36af715')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  // ── Monthly Sale ────────────────────────────────────────────────────────────
  it('edits a monthly-sale record by id', async () => {
    const rec = await createMonthly();
    const res = await request(app)
      .put(`/api/store-reports/monthly-sale/${rec._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ metrics: { sales: 2500 }, month: 3 });
    expectEnvelope(res, 200);
    expect(res.body.data.record.metrics.sales).toBe(2500);
    expect(res.body.data.record.month).toBe(3);
    expect(res.body.data.record.period_key).toBe('2026-03');
  });

  it('deletes a monthly-sale record by id', async () => {
    const rec = await createMonthly();
    const res = await request(app)
      .delete(`/api/store-reports/monthly-sale/${rec._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expectEnvelope(res, 200);
    expect(await StoreReportMonthlySale2026.findById(rec._id)).toBeNull();
  });

  // ── Authorization ───────────────────────────────────────────────────────────
  it('blocks staff (no can_manage_rotas) from editing or deleting', async () => {
    const rec = await createWeekly();
    const staff = await login('staff@org.com', 'Staff@1234');
    const put = await request(app)
      .put(`/api/store-reports/weekly/${rec._id}`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ metrics: { sales: 1 } });
    expect(put.status).toBe(403);
    const del = await request(app)
      .delete(`/api/store-reports/weekly/${rec._id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(del.status).toBe(403);
  });
});
