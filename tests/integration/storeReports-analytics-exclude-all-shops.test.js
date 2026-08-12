/**
 * Regression: an aggregate pseudo-shop named "All Shops" (a company-wide
 * roll-up, e.g. total 3PD across every store) was being summed into v2 analytics
 * as if it were a real store, inflating totals and adding a bogus shop row with
 * 0 labourHours/customerCount. The canonical fetcher must drop it.
 */
const request = require('supertest');
const app = require('../../src/app');
const Shop = require('../../src/models/Shop');
const StoreReportEntry = require('../../src/models/StoreReportEntry');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

const FROM = '2026-05-25';
const TO = '2026-05-31';

describe('Analytics v2 — excludes the "All Shops" aggregate row', () => {
  let fixtures;
  let token;

  const seedWeek = (shop, metrics) =>
    StoreReportEntry.create({
      shop_id: shop._id,
      report_type: 'weekly_financial',
      source_type: 'admin_weekly',
      period_key: '2026-05-W22',
      year: 2026,
      month: 5,
      week_number: 22,
      week_start: new Date('2026-05-25T00:00:00.000Z'),
      week_end: new Date('2026-05-31T23:59:59.999Z'),
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

  it('drops the "All Shops" roll-up from totals and the shops list', async () => {
    // One real store...
    await seedWeek(fixtures.shops.mainShop, {
      'GROSS SALES': 10000,
      'NET SALES': 8000,
      'LABOUR COST ': 2000,
    });
    // ...and a bogus "All Shops" aggregate for the same week.
    const allShops = await Shop.create({
      name: 'All Shops',
      latitude: 0,
      longitude: 0,
      geofence_radius_m: 100,
      opening_time: '08:00',
      closing_time: '22:00',
    });
    await seedWeek(allShops, {
      'GROSS SALES': 51154.63,
      'NET SALES': 41946.8,
      'LABOUR COST ': 4092.37,
    });

    const res = await request(app)
      .get('/api/store-reports/analytics/v2/kpi-matrix')
      .query({ from_date: FROM, to_date: TO, report_type: 'weekly_financial' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Only the real store is counted — not the aggregate.
    expect(res.body.data.total.record_count).toBe(1);
    expect(res.body.data.total.current.grossSales).toBe(10000);
    expect(res.body.data.total.current.labour).toBe(2000);
    const names = res.body.data.shops.map((s) => s.shopName);
    expect(names).not.toContain('All Shops');
  });
});
