const request = require('supertest');
const app = require('../../src/app');
const StoreReportEntry = require('../../src/models/StoreReportEntry');
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
});
