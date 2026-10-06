/**
 * Regression tests for:
 *  1. labour/food/vat % collapsing to 0 because a "… %" key (a ratio) clobbered
 *     the amount key with the same normalized name in readMetric().
 *  2. has_data / data_warning flags on the financial dashboard endpoints.
 */
const request = require('supertest');
const app = require('../../src/app');
const StoreReportEntry = require('../../src/models/StoreReportEntry');
const StoreReportMonthlySale2026 = require('../../src/models/StoreReportMonthlySale2026');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

const FROM = '2026-05-25';
const TO = '2026-05-31';

describe('Analytics v2 — labour % fix + no-data flags', () => {
  let fixtures;
  let token;

  async function seedWeek(shop, metrics) {
    await StoreReportEntry.create({
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
  }

  beforeAll(async () => {
    await connectSandboxDb();
  });
  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    token = adminLogin.token;
  });
  afterAll(async () => {
    await disconnectSandboxDb();
  });

  it('labourPercent is non-zero when the record has both "LABOUR COST" and "Labour cost %" keys', async () => {
    // Mirrors the real prod shape: amount key + ratio key that normalize the same.
    await seedWeek(fixtures.shops.mainShop, {
      'GROSS SALES': 26891.58,
      'NET SALES': 23325.06,
      'LABOUR COST ': 4966.05, // amount (trailing space, like prod)
      'Labour cost %': 0.2129, // ratio — must NOT win
      'BID FOOD': 5206.43,
    });

    const res = await request(app)
      .get('/api/store-reports/analytics/v2/trend')
      .query({
        from_date: FROM,
        to_date: TO,
        report_type: 'weekly_financial',
        metrics: 'labourPercent,foodCostPercent',
        group_by: 'total',
      })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.has_data).toBe(true);
    expect(res.body.data.data_warning).toBeNull();

    // 4966.05 / 23325.06 * 100 ≈ 21.29  (was 0 before the fix)
    expect(res.body.data.total.kpis.labourPercent).toBeGreaterThan(20);
    expect(res.body.data.total.kpis.labourPercent).toBeLessThan(23);
    // food cost still works: 5206.43 / 23325.06 * 100 ≈ 22.3
    expect(res.body.data.total.kpis.foodCostPercent).toBeGreaterThan(20);
  });

  it('KPI matrix labour reads the amount, not the ratio', async () => {
    await seedWeek(fixtures.shops.mainShop, {
      'NET SALES': 10000,
      'LABOUR COST ': 2100,
      'Labour cost %': 0.21,
    });
    const res = await request(app)
      .get('/api/store-reports/analytics/v2/kpi-matrix')
      .query({ from_date: FROM, to_date: TO, report_type: 'weekly_financial' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total.current.labour).toBe(2100); // not 0.21
    expect(res.body.data.total.current.labourPercent).toBe(21); // 2100/10000*100
  });

  it('derives labour from "Labour cost %" when the record has no amount key', async () => {
    // Mirrors the 2025 monthly uploads: only the ratio column, no LABOUR COST.
    await seedWeek(fixtures.shops.mainShop, {
      'GROSS SALES': 12000,
      'NET SALES': 10000,
      'Labour cost %': 0.24,
      'Food cost %': 0.3,
    });
    const res = await request(app)
      .get('/api/store-reports/analytics/v2/kpi-matrix')
      .query({ from_date: FROM, to_date: TO, report_type: 'weekly_financial' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total.current.labour).toBe(2400); // not 0.24
    expect(res.body.data.total.current.labourPercent).toBe(24);
    expect(res.body.data.total.current.foodCost).toBe(3000);
    expect(res.body.data.total.current.foodCostPercent).toBe(30);
  });

  it('accepts a percent-only value already stored as a percentage', async () => {
    await seedWeek(fixtures.shops.mainShop, {
      'NET SALES': 10000,
      'Labour cost %': 21.5,
    });
    const res = await request(app)
      .get('/api/store-reports/analytics/v2/kpi-matrix')
      .query({ from_date: FROM, to_date: TO, report_type: 'weekly_financial' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total.current.labour).toBe(2150);
    expect(res.body.data.total.current.labourPercent).toBe(21.5);
  });

  it('monthly: "Labour %" does not shadow the "Labour Cost" amount', async () => {
    // Mirrors the prod 2025 Monthly Sale rows: raw headers + camelCase copies.
    // "Labour %" normalizes to "labour" — the first labour alias — and used to win.
    await StoreReportMonthlySale2026.create({
      shop_id: fixtures.shops.mainShop._id,
      store_name_raw: 'Main Branch',
      store_key: 'main branch',
      source_sheet: 'Monthly Sale 2025',
      period_key: '2025-07',
      year: 2025,
      month: 7,
      metrics: {
        'Gross Sale': 12000,
        grossSale: 12000,
        'Net Sale': 10000,
        netSale: 10000,
        Bidfood: 2500,
        bidfood: 2500,
        'Bidfood %': 0.25,
        bidfoodPercent: 0.25,
        'Labour Cost': 2400,
        labourCost: 2400,
        'Labour %': 0.24,
        labourPercent: 0.24,
      },
    });
    const res = await request(app)
      .get('/api/store-reports/analytics/v2/kpi-matrix')
      .query({ from_date: '2025-07-01', to_date: '2025-07-31', report_type: 'monthly_store_kpi' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total.current.labour).toBe(2400); // not 0.24
    expect(res.body.data.total.current.labourPercent).toBe(24); // not 0
    expect(res.body.data.total.current.foodCost).toBe(2500);
    expect(res.body.data.total.current.foodCostPercent).toBe(25);
  });

  it('has_data=false with a warning when the selected period has no records', async () => {
    const res = await request(app)
      .get('/api/store-reports/analytics/v2/trend')
      .query({
        from_date: '2020-01-01',
        to_date: '2020-01-07',
        report_type: 'weekly_financial',
        metrics: 'labourPercent',
      })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.has_data).toBe(false);
    expect(res.body.data.data_warning).toMatch(/no financial data/i);
    expect(res.body.data.data_warning).toMatch(/week/i);
  });

  it('monthly no-data warning says "month"', async () => {
    const res = await request(app)
      .get('/api/store-reports/analytics/v2/trend')
      .query({
        from_date: '2020-01-01',
        to_date: '2020-01-31',
        report_type: 'monthly_store_kpi',
        metrics: 'grossSales',
      })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.has_data).toBe(false);
    expect(res.body.data.data_warning).toMatch(/month/i);
  });

  it('kpi-matrix, shop-compare and dashboard also expose has_data', async () => {
    await seedWeek(fixtures.shops.mainShop, { 'NET SALES': 5000, 'LABOUR COST ': 1000 });

    const kpi = await request(app)
      .get('/api/store-reports/analytics/v2/kpi-matrix')
      .query({ from_date: FROM, to_date: TO, report_type: 'weekly_financial' })
      .set('Authorization', `Bearer ${token}`);
    expect(kpi.body.data.has_data).toBe(true);

    const cmp = await request(app)
      .get('/api/store-reports/analytics/v2/shop-compare')
      .query({
        from_date: FROM,
        to_date: TO,
        report_type: 'weekly_financial',
        shop_ids: fixtures.shops.mainShop._id.toString(),
      })
      .set('Authorization', `Bearer ${token}`);
    expect(cmp.body.data.has_data).toBe(true);

    const dash = await request(app)
      .get('/api/store-reports/analytics/dashboard')
      .query({ report_type: 'weekly_financial', from: FROM, to: TO })
      .set('Authorization', `Bearer ${token}`);
    expect(dash.body.data).toHaveProperty('has_data');
  });
});
