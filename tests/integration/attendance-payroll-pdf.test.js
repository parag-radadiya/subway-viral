/**
 * Weekly payroll report — PDF output (?format=pdf) integration tests.
 *
 * Verifies the new opt-in PDF path returns a real PDF as a download, and that
 * the default (no format param) response is unchanged JSON. Runs against an
 * in-memory MongoDB — never a live database.
 */
const request = require('supertest');
const app = require('../../src/app');
const Attendance = require('../../src/models/Attendance');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

const FROM = '2026-04-22';
const TO = '2026-04-28';

describe('Weekly payroll report — PDF output', () => {
  let fixtures;
  let token;
  let shopId;

  beforeAll(async () => {
    await connectSandboxDb();
  });
  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();
    shopId = fixtures.shops.mainShop._id.toString();

    // Two punches for the staff user inside the reporting window.
    await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date('2026-04-22T08:00:00.000Z'),
      punch_out: new Date('2026-04-22T15:11:00.000Z'),
      punch_method: 'GPS+Biometric',
      is_active: true,
    });
    await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date('2026-04-24T09:57:00.000Z'),
      punch_out: new Date('2026-04-24T23:46:00.000Z'),
      punch_method: 'Manual',
      is_manual: true,
      is_active: true,
    });

    const managerLogin = await login('manager@org.com', 'Manager@1234');
    token = managerLogin.token;
  });
  afterAll(async () => {
    await disconnectSandboxDb();
  });

  it('returns a downloadable PDF when format=pdf', async () => {
    const res = await request(app)
      .get('/api/attendance/weekly-payroll-report')
      .query({ shop_id: shopId, from_date: FROM, to_date: TO, format: 'pdf' })
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((r, cb) => {
        const data = [];
        r.on('data', (c) => data.push(c));
        r.on('end', () => cb(null, Buffer.concat(data)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/\.pdf/);
    // Valid PDF signature + non-trivial size.
    expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
    expect(res.body.length).toBeGreaterThan(800);
    expect(Number(res.headers['content-length'])).toBe(res.body.length);
  });

  it('format=PDF is case-insensitive', async () => {
    const res = await request(app)
      .get('/api/attendance/weekly-payroll-report')
      .query({ shop_id: shopId, from_date: FROM, to_date: TO, format: 'PDF' })
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((r, cb) => {
        const data = [];
        r.on('data', (c) => data.push(c));
        r.on('end', () => cb(null, Buffer.concat(data)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('still returns JSON when format is omitted (unchanged contract)', async () => {
    const res = await request(app)
      .get('/api/attendance/weekly-payroll-report')
      .query({ shop_id: shopId, from_date: FROM, to_date: TO })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.status).toBe(200);
    expect(res.body.data.report_title).toBe('Weekly Printed Payroll Report');
    expect(Array.isArray(res.body.data.employees)).toBe(true);
    expect(res.body.data.dates).toHaveLength(7);
  });

  it('includes the populated user name and email per employee', async () => {
    const res = await request(app)
      .get('/api/attendance/weekly-payroll-report')
      .query({ shop_id: shopId, from_date: FROM, to_date: TO })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const emp = res.body.data.employees.find(
      (e) => String(e.user_id) === String(fixtures.users.staffUser._id)
    );
    expect(emp).toBeDefined();
    expect(emp.name).toBe('Dave Staff');
    expect(emp.employee_name).toBe('Dave Staff');
    expect(emp.email).toBe('staff@org.com');
    expect(emp.user).toEqual({
      id: String(fixtures.users.staffUser._id),
      name: 'Dave Staff',
      email: 'staff@org.com',
    });
  });

  it('PDF path still enforces required params (missing shop_id → 400)', async () => {
    const res = await request(app)
      .get('/api/attendance/weekly-payroll-report')
      .query({ from_date: FROM, to_date: TO, format: 'pdf' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
