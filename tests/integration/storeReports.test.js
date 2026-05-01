const fs = require('fs');
const os = require('os');
const path = require('path');
const xlsx = require('xlsx');
const request = require('supertest');
const app = require('../../src/app');
const StoreReportEntry = require('../../src/models/StoreReportEntry');
const StoreReportWeekly2026B = require('../../src/models/StoreReportWeekly2026B');
const StoreReportMonthlySale2026 = require('../../src/models/StoreReportMonthlySale2026');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('Store reports integration', () => {
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

  it('REPORT-001: admin can upsert weekly data and fetch table', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const upsertRes = await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 1,
            week_number: 1,
            week_range_label: '29/12 to 04/01',
            metrics: {
              sales: 500,
              net: 410,
              labour: 40,
              vat18: 90,
              royalties: 51.25,
              foodCost22: 90.2,
              commission: 100,
              commissionPercentage: 20,
              total: 371.45,
              income: 128.55,
            },
          },
        ],
      });

    expectEnvelope(upsertRes, 200);
    expect(upsertRes.body.data.failed).toBe(0);

    const tableRes = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'admin_weekly',
        report_type: 'weekly_financial',
        year: 2026,
        month: 1,
        week_number: 1,
      });

    expectEnvelope(tableRes, 200);
    expect(tableRes.body.data.count).toBe(1);
    expect(tableRes.body.data.rows[0].sales).toBe(285.71);
    expect(tableRes.body.data.totals.sales).toBe(285.71);
  });

  it('REPORT-002: reconciled table prefers admin data over excel data for same period', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await StoreReportEntry.create({
      shop_id: fixtures.shops.mainShop._id,
      report_type: 'weekly_financial',
      source_type: 'excel_raw',
      period_key: '2026-01-W01',
      year: 2026,
      month: 1,
      week_number: 1,
      week_range_label: '29/12 to 04/01',
      metrics: {
        sales: 400,
        net: 350,
      },
    });

    await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 1,
            week_number: 1,
            metrics: {
              sales: 700,
              net: 500,
            },
          },
        ],
      });

    const tableRes = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'reconciled',
        report_type: 'weekly_financial',
        year: 2026,
        month: 1,
        week_number: 1,
      });

    expectEnvelope(tableRes, 200);
    expect(tableRes.body.data.count).toBe(1);
    expect(tableRes.body.data.rows[0].sales).toBe(700);
    expect(tableRes.body.data.rows[0].sourceType).toBe('admin_weekly');
  });

  it('REPORT-003: staff cannot manage or read store report tables', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const writeRes = await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({ entries: [] });

    expectEnvelope(writeRes, 403);

    const readRes = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .query({ view: 'reconciled', report_type: 'weekly_financial' });

    expectEnvelope(readRes, 403);
  });

  it('REPORT-004: weekly entry crossing month is split into two month records', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const upsertRes = await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 1,
            week_number: 5,
            week_range_label: '29/01 to 04/02',
            metrics: {
              sales: 700,
              net: 350,
            },
          },
        ],
      });

    expectEnvelope(upsertRes, 200);
    expect(upsertRes.body.data.failed).toBe(0);

    const janRes = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'admin_weekly',
        report_type: 'weekly_financial',
        year: 2026,
        month: 1,
        week_number: 5,
      });

    expectEnvelope(janRes, 200);
    expect(janRes.body.data.count).toBe(1);
    expect(janRes.body.data.rows[0].weekRange).toBe('29/01 to 31/01');
    expect(janRes.body.data.rows[0].sales).toBe(300);

    const febRes = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'admin_weekly',
        report_type: 'weekly_financial',
        year: 2026,
        month: 2,
        week_number: 5,
      });

    expectEnvelope(febRes, 200);
    expect(febRes.body.data.count).toBe(1);
    expect(febRes.body.data.rows[0].weekRange).toBe('01/02 to 04/02');
    expect(febRes.body.data.rows[0].sales).toBe(400);
  });

  it('REPORT-005: view=all returns excel_raw, admin_weekly and reconciled tables together', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await StoreReportEntry.create({
      shop_id: fixtures.shops.mainShop._id,
      report_type: 'weekly_financial',
      source_type: 'excel_raw',
      period_key: '2026-01-W01',
      year: 2026,
      month: 1,
      week_number: 1,
      week_range_label: '29/12 to 04/01',
      metrics: {
        sales: 400,
      },
    });

    await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 1,
            week_number: 1,
            metrics: { sales: 900 },
          },
        ],
      });

    const allRes = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'all',
        report_type: 'weekly_financial',
        year: 2026,
        month: 1,
        week_number: 1,
      });

    expectEnvelope(allRes, 200);
    expect(allRes.body.data.tables.excel_raw.count).toBe(1);
    expect(allRes.body.data.tables.admin_weekly.count).toBe(1);
    expect(allRes.body.data.tables.reconciled.count).toBe(1);
    expect(allRes.body.data.tables.reconciled.rows[0].sales).toBe(900);
  });

  it('REPORT-006: admin can add and fetch split weekly records with custom metrics', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const upsertRes = await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 1,
            week_number: 5,
            week_range_label: '29/01 to 04/02',
            metrics: {
              sales: 700,
              net: 350,
              ubereatSale: 210,
            },
          },
        ],
      });

    expectEnvelope(upsertRes, 200);
    expect(upsertRes.body.data.failed).toBe(0);

    const janRes = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'admin_weekly',
        report_type: 'weekly_financial',
        year: 2026,
        month: 1,
        week_number: 5,
      });

    expectEnvelope(janRes, 200);
    expect(janRes.body.data.count).toBe(1);
    expect(janRes.body.data.rows[0].weekRange).toBe('29/01 to 31/01');
    expect(janRes.body.data.rows[0].sales).toBe(300);
    expect(janRes.body.data.rows[0].metrics.ubereatSale).toBe(90);

    const febRes = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'admin_weekly',
        report_type: 'weekly_financial',
        year: 2026,
        month: 2,
        week_number: 5,
      });

    expectEnvelope(febRes, 200);
    expect(febRes.body.data.count).toBe(1);
    expect(febRes.body.data.rows[0].weekRange).toBe('01/02 to 04/02');
    expect(febRes.body.data.rows[0].sales).toBe(400);
    expect(febRes.body.data.rows[0].metrics.ubereatSale).toBe(120);
  });

  it('REPORT-007: admin can add two month-wise records in one request and fetch both', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const upsertRes = await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 1,
            week_number: 5,
            week_range_label: '29/01 to 31/01',
            metrics: {
              sales: 300,
              net: 150,
              ubereatSale: 90,
            },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 2,
            week_number: 5,
            week_range_label: '01/02 to 04/02',
            metrics: {
              sales: 400,
              net: 200,
              ubereatSale: 120,
            },
          },
        ],
      });

    expectEnvelope(upsertRes, 200);
    expect(upsertRes.body.data.failed).toBe(0);

    const tableRes = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'admin_weekly',
        report_type: 'weekly_financial',
        year: 2026,
        week_number: 5,
      });

    expectEnvelope(tableRes, 200);
    expect(tableRes.body.data.count).toBe(2);

    const janRow = tableRes.body.data.rows.find((row) => row.month === 1);
    const febRow = tableRes.body.data.rows.find((row) => row.month === 2);

    expect(janRow).toBeTruthy();
    expect(janRow.weekRange).toBe('29/01 to 31/01');
    expect(janRow.sales).toBe(300);
    expect(janRow.metrics.ubereatSale).toBe(90);

    expect(febRow).toBeTruthy();
    expect(febRow.weekRange).toBe('01/02 to 04/02');
    expect(febRow.sales).toBe(400);
    expect(febRow.metrics.ubereatSale).toBe(120);
  });

  it('REPORT-008: dashboard analytics returns KPI totals, channel split and wow comparison', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 14,
            week_range_label: '29/03 to 04/04',
            metrics: {
              sales: 1600,
              income: 320,
              customerCount: 80,
              justeatSale: 200,
              ubereatSale: 100,
              deliverooSale: 100,
            },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 15,
            week_range_label: '05/04 to 11/04',
            metrics: {
              sales: 2000,
              income: 400,
              customerCount: 100,
              justeatSale: 300,
              ubereatSale: 150,
              deliverooSale: 150,
            },
          },
        ],
      });

    const analyticsRes = await request(app)
      .get('/api/store-reports/analytics/dashboard')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'reconciled',
        report_type: 'weekly_financial',
        from: '2026-04-05',
        to: '2026-04-11',
        compare: 'both',
      });

    expectEnvelope(analyticsRes, 200);
    expect(analyticsRes.body.data.kpis.revenue).toBe(2000);
    expect(analyticsRes.body.data.kpis.profit).toBe(400);
    expect(analyticsRes.body.data.kpis.orders).toBe(100);
    expect(analyticsRes.body.data.kpis.averageOrderValue).toBe(20);
    expect(analyticsRes.body.data.kpis.channels.justeat).toBe(300);
    expect(analyticsRes.body.data.comparisons.wow.revenue.previous).toBe(1600);
    expect(analyticsRes.body.data.table_api.paginated).toBe(true);
  });

  it('REPORT-010: table supports optional pagination with count metadata', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 13,
            week_range_label: '01/04 to 07/04',
            metrics: { sales: 1100, net: 800 },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 14,
            week_range_label: '08/04 to 14/04',
            metrics: { sales: 1200, net: 850 },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 15,
            week_range_label: '15/04 to 21/04',
            metrics: { sales: 1300, net: 900 },
          },
        ],
      });

    const tableRes = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'admin_weekly',
        report_type: 'weekly_financial',
        year: 2026,
        month: 4,
        page: 2,
        limit: 2,
      });

    expectEnvelope(tableRes, 200);
    expect(tableRes.body.data.count).toBe(3);
    expect(tableRes.body.data.rows).toHaveLength(1);
    expect(tableRes.body.data.pagination.enabled).toBe(true);
    expect(tableRes.body.data.pagination.basis).toBe('row');
    expect(tableRes.body.data.pagination.page).toBe(2);
    expect(tableRes.body.data.pagination.limit).toBe(2);
    expect(tableRes.body.data.pagination.total).toBe(3);
    expect(tableRes.body.data.pagination.total_pages).toBe(2);
    expect(tableRes.body.data.pagination.page_count).toBe(2);
    expect(tableRes.body.data.pagination.has_prev).toBe(true);
    expect(tableRes.body.data.pagination.has_next).toBe(false);
  });

  it('REPORT-012: week_number pagination keeps complete week rows together', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const upsertRes = await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 20,
            week_range_label: '20/05 to 26/05',
            metrics: { sales: 1000, net: 700 },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.eastShop.name,
            year: 2026,
            month: 4,
            week_number: 20,
            week_range_label: '20/05 to 26/05',
            metrics: { sales: 600, net: 400 },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 21,
            week_range_label: '27/05 to 31/05',
            metrics: { sales: 900, net: 650 },
          },
        ],
      });

    expectEnvelope(upsertRes, 200);

    const page1Res = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'admin_weekly',
        report_type: 'weekly_financial',
        year: 2026,
        page: 1,
        limit: 1,
        pagination_basis: 'week_number',
      });

    expectEnvelope(page1Res, 200);
    expect(page1Res.body.data.pagination.basis).toBe('week_number');
    expect(page1Res.body.data.pagination.total_weeks).toBe(2);
    expect(page1Res.body.data.pagination.count).toBe(1);
    expect(page1Res.body.data.rows).toHaveLength(2);
    expect(page1Res.body.data.rows.every((row) => row.weekNumber === 20)).toBe(true);

    const page2Res = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'admin_weekly',
        report_type: 'weekly_financial',
        year: 2026,
        page: 2,
        limit: 1,
        pagination_basis: 'week_number',
      });

    expectEnvelope(page2Res, 200);
    expect(page2Res.body.data.rows).toHaveLength(1);
    expect(page2Res.body.data.rows[0].weekNumber).toBe(21);
  });

  it('REPORT-013: group_by=month derives monthly rows from weekly_financial data', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 17,
            week_range_label: '01/04 to 07/04',
            metrics: {
              sales: 1000,
              net: 700,
              labour: 100,
              vat18: 80,
              royalties: 20,
              foodCost22: 140,
              commission: 100,
              total: 340,
              income: 360,
              'Total 3PD Sale': 200,
            },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 18,
            week_range_label: '08/04 to 14/04',
            metrics: {
              sales: 600,
              net: 450,
              labour: 60,
              vat18: 50,
              royalties: 10,
              foodCost22: 90,
              commission: 50,
              total: 210,
              income: 240,
              'Total 3PD Sale': 100,
            },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.eastShop.name,
            year: 2026,
            month: 4,
            week_number: 17,
            week_range_label: '01/04 to 07/04',
            metrics: {
              sales: 500,
              net: 350,
              labour: 40,
              vat18: 30,
              royalties: 10,
              foodCost22: 70,
              commission: 20,
              total: 170,
              income: 180,
              'Total 3PD Sale': 50,
            },
          },
        ],
      });

    const tableRes = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'admin_weekly',
        report_type: 'weekly_financial',
        year: 2026,
        month: 4,
        group_by: 'month',
        page: 1,
        limit: 10,
      });

    expectEnvelope(tableRes, 200);
    expect(tableRes.body.data.group_by).toBe('month');
    expect(tableRes.body.data.columns.map((col) => col.key)).toEqual([
      'shopName',
      'weekNumber',
      'weekRange',
      'sales',
      'net',
      'labour',
      'vat18',
      'royalties',
      'foodCost22',
      'commission',
      'commissionPercentage',
      'total',
      'income',
    ]);
    expect(tableRes.body.data.rows).toHaveLength(2);

    const mainRow = tableRes.body.data.rows.find(
      (row) => String(row.shopId) === String(fixtures.shops.mainShop._id)
    );
    const eastRow = tableRes.body.data.rows.find(
      (row) => String(row.shopId) === String(fixtures.shops.eastShop._id)
    );

    expect(mainRow.sales).toBe(1600);
    expect(mainRow.net).toBe(1150);
    expect(mainRow.total).toBe(700);
    expect(mainRow.income).toBe(450);
    expect(mainRow.commissionPercentage).toBe(0.5);
    expect(mainRow.sourceType).toBe('derived_monthly_from_weekly');

    expect(eastRow.sales).toBe(500);
    expect(eastRow.net).toBe(350);
    expect(eastRow.total).toBe(170);
    expect(eastRow.income).toBe(180);
  });

  it('REPORT-011: table can return weekly totals aggregated across all shops', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const upsertRes = await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 16,
            week_range_label: '22/04 to 28/04',
            metrics: { sales: 1000, net: 700, income: 250 },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.eastShop.name,
            year: 2026,
            month: 4,
            week_number: 16,
            week_range_label: '22/04 to 28/04',
            metrics: { sales: 500, net: 350, income: 120 },
          },
        ],
      });

    expectEnvelope(upsertRes, 200);

    const tableRes = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'admin_weekly',
        report_type: 'weekly_financial',
        year: 2026,
        month: 4,
        week_number: 16,
        include_weekly_totals: true,
      });

    expectEnvelope(tableRes, 200);
    expect(tableRes.body.data.count).toBe(2);
    expect(tableRes.body.data.weekly_totals).toHaveLength(1);
    expect(tableRes.body.data.weekly_totals[0].sales).toBe(1500);
    expect(tableRes.body.data.weekly_totals[0].net).toBe(1050);
    expect(tableRes.body.data.weekly_totals[0].income).toBe(370);
    expect(tableRes.body.data.weekly_totals[0].shopCount).toBe(2);
  });

  it('REPORT-014: summary analytics returns KPI totals with comparison blocks', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 14,
            week_range_label: '29/03 to 04/04',
            metrics: { sales: 1000, income: 200, customerCount: 50 },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 15,
            week_range_label: '05/04 to 11/04',
            metrics: { sales: 1400, income: 280, customerCount: 70 },
          },
        ],
      });

    const summaryRes = await request(app)
      .get('/api/store-reports/analytics/summary')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'reconciled',
        report_type: 'weekly_financial',
        from: '2026-04-05',
        to: '2026-04-11',
        compare: 'both',
      });

    expectEnvelope(summaryRes, 200);
    expect(summaryRes.body.data.kpis.revenue).toBe(1400);
    expect(summaryRes.body.data.kpis.profit).toBe(280);
    expect(summaryRes.body.data.kpis.orders).toBe(70);
    expect(summaryRes.body.data.comparisons.wow.revenue.previous).toBe(1000);
  });

  it('REPORT-017: summary analytics supports custom wow comparison window', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 15,
            week_range_label: '05/04 to 11/04',
            metrics: { sales: 1400, income: 280, customerCount: 70 },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 3,
            week_number: 10,
            week_range_label: '02/03 to 08/03',
            metrics: { sales: 500, income: 100, customerCount: 25 },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 14,
            week_range_label: '29/03 to 04/04',
            metrics: { sales: 999, income: 199, customerCount: 50 },
          },
        ],
      });

    const summaryRes = await request(app)
      .get('/api/store-reports/analytics/summary')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'reconciled',
        report_type: 'weekly_financial',
        from: '2026-04-05',
        to: '2026-04-11',
        compare: 'wow',
        wow_from: '2026-03-02',
        wow_to: '2026-03-08',
      });

    expectEnvelope(summaryRes, 200);
    expect(summaryRes.body.data.kpis.revenue).toBe(1400);
    expect(summaryRes.body.data.comparisons.wow.revenue.previous).toBe(500);
    expect(summaryRes.body.data.comparison_windows.wow.mode).toBe('custom');
    expect(summaryRes.body.data.comparison_windows.wow.from).toBe('2026-03-02T00:00:00.000Z');
    expect(summaryRes.body.data.comparison_windows.wow.to).toBe('2026-03-08T23:59:59.999Z');
  });

  it('REPORT-018: summary analytics validates partial custom comparison window params', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const summaryRes = await request(app)
      .get('/api/store-reports/analytics/summary')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        report_type: 'weekly_financial',
        compare: 'wow',
        wow_from: '2026-03-02',
      });

    expectEnvelope(summaryRes, 400);
  });

  it('REPORT-019: dashboard analytics compares selected channel metrics for wow window', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 15,
            week_range_label: '05/04 to 11/04',
            metrics: {
              sales: 2000,
              income: 400,
              customerCount: 100,
              justeatSale: 300,
              ubereatSale: 150,
              deliverooSale: 150,
            },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 14,
            week_range_label: '29/03 to 04/04',
            metrics: {
              sales: 1600,
              income: 320,
              customerCount: 80,
              justeatSale: 200,
              ubereatSale: 100,
              deliverooSale: 100,
            },
          },
        ],
      });

    const dashboardRes = await request(app)
      .get('/api/store-reports/analytics/dashboard')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'reconciled',
        report_type: 'weekly_financial',
        from: '2026-04-05',
        to: '2026-04-11',
        compare: 'wow',
        channels: 'justeat,ubereat,deliveroo,offline',
      });

    expectEnvelope(dashboardRes, 200);
    expect(dashboardRes.body.data.filters.channels).toEqual([
      'justeat',
      'ubereat',
      'deliveroo',
      'instore',
    ]);
    expect(dashboardRes.body.data.comparisons.wow.channels.justeat.previous).toBe(200);
    expect(dashboardRes.body.data.comparisons.wow.channels.justeat.current).toBe(300);
    expect(dashboardRes.body.data.comparisons.wow.channels.instore.current).toBe(1400);
    expect(dashboardRes.body.data.comparisons.wow.channels.instore.previous).toBe(1200);
    expect(dashboardRes.body.data.charts.channelTotals.current.instore).toBe(1400);
  });

  it('REPORT-020: dashboard analytics validates invalid channels query', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const dashboardRes = await request(app)
      .get('/api/store-reports/analytics/dashboard')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        report_type: 'weekly_financial',
        compare: 'wow',
        channels: 'justeat,random_channel',
      });

    expectEnvelope(dashboardRes, 400);
  });

  it('REPORT-021: admin can import historical workbook into all three report collections', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const tempFilePath = path.join(os.tmpdir(), `store-reports-${Date.now()}.xlsx`);

    const workbook = xlsx.utils.book_new();
    const janDecSheet = xlsx.utils.aoa_to_sheet([
      ['Jan-26', 'STORE ', 'Gross Sale', 'Net Sale', 'Vat', 'Vat %'],
      ['', '', '', '', '', ''],
      ['', fixtures.shops.mainShop.name, '1000', '800', '200', '20%'],
    ]);
    const weeklySheet = xlsx.utils.aoa_to_sheet([
      ['', 'Week Ending', 'Sales', 'Net', 'Labour', 'VAT 18%', 'Total', 'Income'],
      ['1', '29/12 To 04/01', '500', '410', '40', '90', '371.45', '128.55'],
    ]);
    const monthlySaleSheet = xlsx.utils.aoa_to_sheet([
      ['Jan-26', 'STORE ', 'Gross Sale', 'Net Sale', 'Vat', 'Vat %', 'Customer Count'],
      ['', '', '', '', '', '', ''],
      ['', fixtures.shops.mainShop.name, '1200', '1000', '200', '20%', '90'],
    ]);

    xlsx.utils.book_append_sheet(workbook, janDecSheet, 'Jan-Dec 26');
    xlsx.utils.book_append_sheet(workbook, weeklySheet, 'Weekly 2026B');
    xlsx.utils.book_append_sheet(workbook, monthlySaleSheet, 'Monthly Sale 2026');
    xlsx.writeFile(workbook, tempFilePath);

    try {
      const importRes = await request(app)
        .post('/api/store-reports/import-historical-workbook')
        .set('Authorization', `Bearer ${adminLogin.token}`)
        .attach('file', tempFilePath)
        .field('year', '2026')
        .field('weekly_store_name', fixtures.shops.mainShop.name);

      expectEnvelope(importRes, 200);
      expect(importRes.body.data.imported.store_report_entry).toBeGreaterThan(0);
      expect(importRes.body.data.imported.weekly_2026b).toBe(1);
      expect(importRes.body.data.imported.monthly_sale_2026).toBe(1);

      expect(
        await StoreReportEntry.countDocuments({ source_type: 'excel_raw', year: 2026, month: 1 })
      ).toBeGreaterThan(0);
      expect(await StoreReportWeekly2026B.countDocuments()).toBe(1);
      expect(await StoreReportMonthlySale2026.countDocuments()).toBe(1);

      const secondImportRes = await request(app)
        .post('/api/store-reports/import-historical-workbook')
        .set('Authorization', `Bearer ${adminLogin.token}`)
        .attach('file', tempFilePath)
        .field('year', '2026')
        .field('weekly_store_name', fixtures.shops.mainShop.name);

      expectEnvelope(secondImportRes, 200);
      expect(await StoreReportWeekly2026B.countDocuments()).toBe(1);
      expect(await StoreReportMonthlySale2026.countDocuments()).toBe(1);
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  });

  it('REPORT-015: store ranking returns sorted stores by selected metric', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 19,
            week_range_label: '12/05 to 18/05',
            metrics: { sales: 2200, income: 420, customerCount: 110 },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.eastShop.name,
            year: 2026,
            month: 4,
            week_number: 19,
            week_range_label: '12/05 to 18/05',
            metrics: { sales: 900, income: 180, customerCount: 45 },
          },
        ],
      });

    const rankingRes = await request(app)
      .get('/api/store-reports/analytics/store-ranking')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'admin_weekly',
        report_type: 'weekly_financial',
        metric: 'revenue',
        sort: 'desc',
        limit: 5,
      });

    expectEnvelope(rankingRes, 200);
    expect(rankingRes.body.data.rows.length).toBeGreaterThanOrEqual(2);
    expect(rankingRes.body.data.rows[0].revenue).toBeGreaterThanOrEqual(
      rankingRes.body.data.rows[1].revenue
    );
  });

  it('REPORT-016: trends and sales chart return total and by-shop series', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.mainShop.name,
            year: 2026,
            month: 4,
            week_number: 20,
            week_range_label: '19/05 to 25/05',
            metrics: { sales: 1500, income: 300, customerCount: 75 },
          },
          {
            report_type: 'weekly_financial',
            store_name: fixtures.shops.eastShop.name,
            year: 2026,
            month: 4,
            week_number: 20,
            week_range_label: '19/05 to 25/05',
            metrics: { sales: 700, income: 130, customerCount: 35 },
          },
        ],
      });

    const trendsRes = await request(app)
      .get('/api/store-reports/analytics/trends')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'reconciled',
        report_type: 'weekly_financial',
        metric: 'revenue',
        granularity: 'week',
        top_n: 3,
        selected_shop_id: fixtures.shops.mainShop._id.toString(),
      });

    expectEnvelope(trendsRes, 200);
    expect(Array.isArray(trendsRes.body.data.total.series)).toBe(true);
    expect(Array.isArray(trendsRes.body.data.shops)).toBe(true);
    expect(trendsRes.body.data.shops.length).toBeGreaterThan(0);

    const salesChartRes = await request(app)
      .get('/api/store-reports/analytics/charts/sales')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'reconciled',
        report_type: 'weekly_financial',
        granularity: 'week',
        top_n: 3,
        selected_shop_id: fixtures.shops.mainShop._id.toString(),
      });

    expectEnvelope(salesChartRes, 200);
    expect(Array.isArray(salesChartRes.body.data.total.series)).toBe(true);
    expect(Array.isArray(salesChartRes.body.data.shops)).toBe(true);
    expect(salesChartRes.body.data.shops.length).toBeGreaterThan(0);
  });

  it('REPORT-009: staff cannot access dashboard analytics endpoint', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const analyticsRes = await request(app)
      .get('/api/store-reports/analytics/dashboard')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .query({ report_type: 'weekly_financial' });

    expectEnvelope(analyticsRes, 403);
  });

  it('REPORT-020: alias-based store name matching resolves shop_id via admin-weekly', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    // 'Baker St' is an alias for 'Main Branch' (set in seedTestData)
    const upsertRes = await request(app)
      .post('/api/store-reports/admin-weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        entries: [
          {
            report_type: 'weekly_financial',
            store_name: 'Baker St',
            year: 2026,
            month: 6,
            week_number: 25,
            week_range_label: '15/06 to 21/06',
            metrics: { sales: 1250, net: 900 },
          },
          {
            report_type: 'weekly_financial',
            store_name: 'Camden',
            year: 2026,
            month: 6,
            week_number: 25,
            week_range_label: '15/06 to 21/06',
            metrics: { sales: 800, net: 550 },
          },
        ],
      });

    expectEnvelope(upsertRes, 200);
    expect(upsertRes.body.data.failed).toBe(0);

    const tableRes = await request(app)
      .get('/api/store-reports/table')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        view: 'admin_weekly',
        report_type: 'weekly_financial',
        year: 2026,
        month: 6,
        week_number: 25,
      });

    expectEnvelope(tableRes, 200);
    expect(tableRes.body.data.count).toBe(2);

    const mainRow = tableRes.body.data.rows.find(
      (row) => String(row.shopId) === String(fixtures.shops.mainShop._id)
    );
    const eastRow = tableRes.body.data.rows.find(
      (row) => String(row.shopId) === String(fixtures.shops.eastShop._id)
    );

    expect(mainRow).toBeTruthy();
    expect(mainRow.sales).toBe(1250);
    expect(eastRow).toBeTruthy();
    expect(eastRow.sales).toBe(800);
  });

  it('REPORT-021: STORE label rows are skipped during monthly sale import', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const tmpDir = os.tmpdir();
    const wb = xlsx.utils.book_new();

    const monthlyData = [
      ['Store', 'Gross Sale', 'Net Sale'],
      ['Jan-26'],
      ['STORE', 100, 80],
      ['Baker St', 500, 400],
      ['Camden', 300, 250],
    ];
    const monthlySheet = xlsx.utils.aoa_to_sheet(monthlyData);
    xlsx.utils.book_append_sheet(wb, monthlySheet, 'Monthly Sale 2026');

    const weeklyData = [
      ['', 'Week Ending', 'Sales', 'Net'],
      [1, '01/01 to 07/01', 100, 80],
    ];
    const weeklySheet = xlsx.utils.aoa_to_sheet(weeklyData);
    xlsx.utils.book_append_sheet(wb, weeklySheet, 'Weekly 2026');

    const janDecData = [['Store', 'Week Ending', 'Sales', 'Net']];
    const janDecSheet = xlsx.utils.aoa_to_sheet(janDecData);
    xlsx.utils.book_append_sheet(wb, janDecSheet, 'Jan-Dec 26');

    const testFile = path.join(tmpDir, `alias-store-test-${Date.now()}.xlsx`);
    xlsx.writeFile(wb, testFile);

    try {
      const importRes = await request(app)
        .post('/api/store-reports/import-historical-workbook')
        .set('Authorization', `Bearer ${adminLogin.token}`)
        .attach('file', testFile)
        .field('year', '2026');

      expectEnvelope(importRes, 200);

      // STORE row should be skipped as a label row
      const monthlySaleRecords = await StoreReportMonthlySale2026.find({
        source_sheet: 'Monthly Sale 2026',
      });

      const storeNames = monthlySaleRecords.map((r) => r.store_name_raw);
      expect(storeNames).not.toContain('STORE');

      // Baker St and Camden should resolve to shops via aliases
      const matched = monthlySaleRecords.filter((r) => r.shop_id != null);
      expect(matched.length).toBe(2);
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  it('REPORT-022: admin can POST a single weekly entry and GET it back', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const postRes = await request(app)
      .post('/api/store-reports/weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        store_name: 'Baker St',
        year: 2026,
        month: 3,
        week_number: 10,
        week_range_label: '02/03 to 08/03',
        metrics: { sales: 4500, net: 3200 },
      });

    expectEnvelope(postRes, 200);
    expect(postRes.body.data.record).toBeTruthy();
    expect(postRes.body.data.record.store_name_raw).toBe('Baker St');
    expect(postRes.body.data.record.store_key).toBe('baker st');
    expect(String(postRes.body.data.record.shop_id)).toBe(String(fixtures.shops.mainShop._id));

    const getRes = await request(app)
      .get('/api/store-reports/weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({ year: 2026, month: 3, week_number: 10 });

    expectEnvelope(getRes, 200);
    expect(getRes.body.data.rows.length).toBe(1);
    expect(getRes.body.data.rows[0].metrics.sales).toBe(4500);
    expect(getRes.body.data.count).toBe(1);
  });

  it('REPORT-023: admin can POST a single monthly-sale entry and GET it back', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const postRes = await request(app)
      .post('/api/store-reports/monthly-sale')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        store_name: 'Camden',
        year: 2026,
        month: 5,
        metrics: { grossSale: 12000, netSale: 9500, vat: 2500 },
      });

    expectEnvelope(postRes, 200);
    expect(postRes.body.data.record).toBeTruthy();
    expect(postRes.body.data.record.store_name_raw).toBe('Camden');
    expect(String(postRes.body.data.record.shop_id)).toBe(String(fixtures.shops.eastShop._id));

    const getRes = await request(app)
      .get('/api/store-reports/monthly-sale')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({ year: 2026, month: 5 });

    expectEnvelope(getRes, 200);
    expect(getRes.body.data.rows.length).toBe(1);
    expect(getRes.body.data.rows[0].metrics.grossSale).toBe(12000);
    expect(getRes.body.data.count).toBe(1);
  });

  it('REPORT-024: POST weekly validates required fields', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const noYear = await request(app)
      .post('/api/store-reports/weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ store_name: 'Baker St', metrics: { sales: 100 } });

    expectEnvelope(noYear, 400);

    const noMetrics = await request(app)
      .post('/api/store-reports/weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ store_name: 'Baker St', year: 2026, month: 1, week_number: 1 });

    expectEnvelope(noMetrics, 400);

    const noStore = await request(app)
      .post('/api/store-reports/weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ year: 2026, month: 1, week_number: 1, metrics: { sales: 100 } });

    expectEnvelope(noStore, 400);
  });

  it('REPORT-025: POST monthly-sale validates required fields', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const noYear = await request(app)
      .post('/api/store-reports/monthly-sale')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ store_name: 'Camden', metrics: { grossSale: 100 } });

    expectEnvelope(noYear, 400);

    const noMetrics = await request(app)
      .post('/api/store-reports/monthly-sale')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ store_name: 'Camden', year: 2026, month: 1 });

    expectEnvelope(noMetrics, 400);
  });

  it('REPORT-026: export returns xlsx with correct sheets after inserting data', async () => {
    const xlsx = require('xlsx');
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    // Seed weekly + monthly data
    await request(app)
      .post('/api/store-reports/weekly')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        store_name: 'Baker St',
        year: 2026,
        month: 3,
        week_number: 10,
        week_range_label: '02/03 to 08/03',
        metrics: { sales: 4500, net: 3200 },
      });

    await request(app)
      .post('/api/store-reports/monthly-sale')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        store_name: 'Camden',
        year: 2026,
        month: 5,
        metrics: { grossSale: 12000, netSale: 9500 },
      });

    const exportRes = await request(app)
      .get('/api/store-reports/export')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({ year: 2026 })
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(exportRes.status).toBe(200);
    expect(exportRes.headers['content-type']).toContain('spreadsheetml');
    expect(exportRes.headers['content-disposition']).toContain('store_report_2026.xlsx');

    const wb = xlsx.read(exportRes.body, { type: 'buffer' });
    expect(wb.SheetNames).toContain('Weekly');
    expect(wb.SheetNames).toContain('Monthly Sale');

    const weeklyData = xlsx.utils.sheet_to_json(wb.Sheets['Weekly']);
    expect(weeklyData.length).toBeGreaterThanOrEqual(1);
    expect(weeklyData[0]['Store']).toBe('Baker St');
    expect(weeklyData[0]['sales']).toBe(4500);

    const monthlyData = xlsx.utils.sheet_to_json(wb.Sheets['Monthly Sale']);
    const camdenRow = monthlyData.find((r) => r['Store'] === 'Camden');
    expect(camdenRow).toBeTruthy();
    expect(camdenRow['grossSale']).toBe(12000);
  });
});
