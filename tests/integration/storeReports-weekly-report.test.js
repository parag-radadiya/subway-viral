/**
 * Weekly report analytics (by-week totals series) + the "Unknown" aggregate is
 * excluded from the per-shop v2 analytics.
 */
const request = require('supertest');
const app = require('../../src/app');
const StoreReportEntry = require('../../src/models/StoreReportEntry');
const StoreReportWeekly2026B = require('../../src/models/StoreReportWeekly2026B');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

const WR = '/api/store-reports/analytics/v2/weekly-report';
const KPI = '/api/store-reports/analytics/v2/kpi-matrix';

describe('Weekly report analytics', () => {
  let fixtures;
  let token;

  const seedWeekTotal = (weekNumber, weekStart, weekEnd, metrics) =>
    StoreReportWeekly2026B.create({
      shop_id: null,
      source_sheet: 'Weekly 2026',
      period_key: `2026-W${weekNumber}`,
      store_key: 'unknown',
      store_name_raw: 'Unknown',
      year: 2026,
      month: 7,
      week_number: weekNumber,
      week_start: new Date(weekStart),
      week_end: new Date(weekEnd),
      week_range_label: `wk${weekNumber}`,
      metrics,
    });

  beforeAll(async () => {
    await connectSandboxDb();
  });
  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();
    token = (await login('admin@org.com', 'Admin@1234')).token;
  });
  afterAll(async () => {
    await disconnectSandboxDb();
  });

  it('returns summary, per-week trend, and period comparison', async () => {
    await seedWeekTotal(28, '2026-07-06', '2026-07-12', { sales: 50000, net: 40000, commision: 15000 });
    await seedWeekTotal(29, '2026-07-13', '2026-07-19', { sales: 46000, net: 37000, commision: 14000 });
    // comparison window (earlier weeks)
    await seedWeekTotal(26, '2026-06-22', '2026-06-28', { sales: 40000, net: 33000, commision: 12000 });

    const res = await request(app)
      .get(`${WR}?from_date=2026-07-06&to_date=2026-07-19&compare_from=2026-06-22&compare_to=2026-06-28`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.weeks_count).toBe(2);
    expect(d.summary.sales).toBe(96000); // 50000 + 46000
    expect(d.summary.net).toBe(77000);
    expect(d.summary.commission).toBe(29000);
    expect(d.summary.commissionPercent).toBe(0.3); // round2(29000/96000)
    expect(d.trend).toHaveLength(2);
    expect(d.trend.map((t) => t.week_number)).toEqual([28, 29]);
    // comparison vs the single earlier week
    expect(d.comparison.compare.sales).toBe(40000);
    expect(d.comparison.delta.sales.change).toBe(56000);
  });

  it('returns has_data=false for a range with no weeks', async () => {
    const res = await request(app)
      .get(`${WR}?from_date=2026-01-01&to_date=2026-01-07`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.has_data).toBe(false);
    expect(res.body.data.weeks_count).toBe(0);
  });

  it('excludes the "Unknown" aggregate row from the per-shop kpi-matrix', async () => {
    // A real shop row...
    await StoreReportEntry.create({
      shop_id: fixtures.shops.mainShop._id,
      report_type: 'weekly_financial',
      source_type: 'excel_raw',
      period_key: '2026-07-W28',
      year: 2026,
      month: 7,
      week_number: 28,
      week_start: new Date('2026-07-06T00:00:00.000Z'),
      week_end: new Date('2026-07-12T23:59:59.999Z'),
      metrics: { sales: 10000, net: 8000 },
    });
    // ...and the "Unknown" by-week aggregate for the same window.
    await seedWeekTotal(28, '2026-07-06', '2026-07-12', { sales: 50000, net: 40000 });

    const res = await request(app)
      .get(`${KPI}?from_date=2026-07-06&to_date=2026-07-12&report_type=weekly_financial&view=reconciled`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const names = (res.body.data.shops || []).map((s) => String(s.shopName).toLowerCase());
    expect(names).not.toContain('unknown');
  });
});
