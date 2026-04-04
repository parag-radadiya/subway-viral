const request = require('supertest');
const app = require('../../src/app');
const Attendance = require('../../src/models/Attendance');
const Rota = require('../../src/models/Rota');
const Role = require('../../src/models/Role');
const Shop = require('../../src/models/Shop');
const User = require('../../src/models/User');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('Attendance module integration', () => {
  let fixtures;

  beforeAll(async () => {
    await connectSandboxDb();
  });

  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();
    await Shop.findByIdAndUpdate(fixtures.shops.mainShop._id, {
      opening_time: '10:00',
      closing_time: '14:00',
    });

    const now = new Date();
    const shiftStart = new Date(now.getTime() - 30 * 60 * 1000);
    const shiftEnd = new Date(now.getTime() + 7 * 60 * 60 * 1000);

    await Rota.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      shift_start: shiftStart,
      shift_end: shiftEnd,
      note: 'Test current shift',
    });
  });

  afterAll(async () => {
    await disconnectSandboxDb();
  });

  it('ATT-001 and ATT-004: verifies location and punches in with valid handshake', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const verifyRes = await request(app)
      .post('/api/attendance/verify-location')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        latitude: 51.5074,
        longitude: -0.1278,
      });

    expectEnvelope(verifyRes, 200);
    const locationToken = verifyRes.body.data.location_token;
    expect(locationToken).toBeTruthy();

    const punchRes = await request(app)
      .post('/api/attendance/punch-in')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .set('x-device-id', 'staff-device-001')
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        location_token: locationToken,
        biometric_verified: true,
      });

    expectEnvelope(punchRes, 201);
    expect(punchRes.body.data.attendance.punch_method).toBe('GPS+Biometric');
  });

  it('ATT-002: rejects verify-location when user is outside geofence', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const res = await request(app)
      .post('/api/attendance/verify-location')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        latitude: 0,
        longitude: 0,
      });

    expectEnvelope(res, 403);
  });

  it('ATT-003: rejects verify-location when required fields are missing', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');
    const res = await request(app)
      .post('/api/attendance/verify-location')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({ shop_id: fixtures.shops.mainShop._id.toString() });

    expectEnvelope(res, 400);
  });

  it('ATT-005: blocks punch-in when biometric_verified is false', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');
    const verifyRes = await request(app)
      .post('/api/attendance/verify-location')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        latitude: 51.5074,
        longitude: -0.1278,
      });

    const res = await request(app)
      .post('/api/attendance/punch-in')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .set('x-device-id', 'staff-device-001')
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        location_token: verifyRes.body.data.location_token,
        biometric_verified: false,
      });

    expectEnvelope(res, 403);
  });

  it('ATT-006: blocks punch-in when location token shop/user does not match payload', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');
    const verifyRes = await request(app)
      .post('/api/attendance/verify-location')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        latitude: 51.5074,
        longitude: -0.1278,
      });

    const res = await request(app)
      .post('/api/attendance/punch-in')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .set('x-device-id', 'staff-device-001')
      .send({
        shop_id: fixtures.shops.eastShop._id.toString(),
        location_token: verifyRes.body.data.location_token,
        biometric_verified: true,
      });

    expectEnvelope(res, 403);
  });

  it('ATT-007: blocks punch-in with invalid location token', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');
    const res = await request(app)
      .post('/api/attendance/punch-in')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .set('x-device-id', 'staff-device-001')
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        location_token: 'invalid.token.value',
        biometric_verified: true,
      });

    expectEnvelope(res, 403);
  });

  it('ATT-008: blocks punch-in when x-device-id does not match', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const verifyRes = await request(app)
      .post('/api/attendance/verify-location')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        latitude: 51.5074,
        longitude: -0.1278,
      });

    const res = await request(app)
      .post('/api/attendance/punch-in')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .set('x-device-id', 'bad-device-id')
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        location_token: verifyRes.body.data.location_token,
        biometric_verified: true,
      });

    expectEnvelope(res, 403);
  });

  it('ATT-018: blocks punch-in when user has not registered device yet', async () => {
    await User.findByIdAndUpdate(fixtures.users.staffUser._id, { device_id: null });
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const verifyRes = await request(app)
      .post('/api/attendance/verify-location')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        latitude: 51.5074,
        longitude: -0.1278,
      });

    const res = await request(app)
      .post('/api/attendance/punch-in')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .set('x-device-id', 'any-device')
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        location_token: verifyRes.body.data.location_token,
        biometric_verified: true,
      });

    expectEnvelope(res, 403);
  });

  it('ATT-012: blocks punch-out for another users attendance record', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const managerRecord = await Attendance.create({
      user_id: fixtures.users.managerUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date(),
      is_manual: false,
      punch_method: 'GPS+Biometric',
    });

    const res = await request(app)
      .put(`/api/attendance/${managerRecord._id}/punch-out`)
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({});

    expectEnvelope(res, 403);

    // Sanity check that manager can punch out own record if needed.
    const okRes = await request(app)
      .put(`/api/attendance/${managerRecord._id}/punch-out`)
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({});

    expectEnvelope(okRes, 200);
  });

  it('ATT-009: blocks punch-in when user already has open attendance', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const verifyRes = await request(app)
      .post('/api/attendance/verify-location')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        latitude: 51.5074,
        longitude: -0.1278,
      });

    const firstPunch = await request(app)
      .post('/api/attendance/punch-in')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .set('x-device-id', 'staff-device-001')
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        location_token: verifyRes.body.data.location_token,
        biometric_verified: true,
      });
    expectEnvelope(firstPunch, 201);

    const secondVerify = await request(app)
      .post('/api/attendance/verify-location')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        latitude: 51.5074,
        longitude: -0.1278,
      });

    const secondPunch = await request(app)
      .post('/api/attendance/punch-in')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .set('x-device-id', 'staff-device-001')
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        location_token: secondVerify.body.data.location_token,
        biometric_verified: true,
      });

    expectEnvelope(secondPunch, 400);
  });

  it('ATT-010 and ATT-011: user can punch out own record once only', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');
    const record = await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date(),
      is_manual: false,
      punch_method: 'GPS+Biometric',
    });

    const successRes = await request(app)
      .put(`/api/attendance/${record._id}/punch-out`)
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({});
    expectEnvelope(successRes, 200);

    const duplicateRes = await request(app)
      .put(`/api/attendance/${record._id}/punch-out`)
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({});
    expectEnvelope(duplicateRes, 400);
  });

  it('ATT-015: manual punch returns not found for unknown staff user', async () => {
    const subMgrLogin = await login('submanager@org.com', 'SubMgr@1234');

    const res = await request(app)
      .post('/api/attendance/manual-punch-in')
      .set('Authorization', `Bearer ${subMgrLogin.token}`)
      .send({
        user_id: '507f1f77bcf86cd799439011',
        shop_id: fixtures.shops.mainShop._id.toString(),
      });

    expectEnvelope(res, 404);
  });

  it('ATT-016 and ATT-017: attendance list is allowed for manager and self-scoped for staff', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date(),
      is_manual: false,
      punch_method: 'GPS+Biometric',
    });

    await Attendance.create({
      user_id: fixtures.users.managerUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date(),
      is_manual: false,
      punch_method: 'GPS+Biometric',
    });

    const allowedRes = await request(app)
      .get('/api/attendance')
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(allowedRes, 200);
    expect(Array.isArray(allowedRes.body.data.records)).toBe(true);

    const staffRes = await request(app)
      .get(`/api/attendance?user_id=${fixtures.users.managerUser._id}`)
      .set('Authorization', `Bearer ${staffLogin.token}`);

    expectEnvelope(staffRes, 200);
    expect(Array.isArray(staffRes.body.data.records)).toBe(true);
    staffRes.body.data.records.forEach((record) => {
      expect(record.user_id._id).toBe(fixtures.users.staffUser._id.toString());
    });
  });

  it('ATT-013 and ATT-014: allows manual punch with permission and blocks without it', async () => {
    const subMgrLogin = await login('submanager@org.com', 'SubMgr@1234');
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const successRes = await request(app)
      .post('/api/attendance/manual-punch-in')
      .set('Authorization', `Bearer ${subMgrLogin.token}`)
      .send({
        user_id: fixtures.users.staffUser._id.toString(),
        shop_id: fixtures.shops.mainShop._id.toString(),
      });

    expectEnvelope(successRes, 201);
    expect(successRes.body.data.attendance.is_manual).toBe(true);

    const forbiddenRes = await request(app)
      .post('/api/attendance/manual-punch-in')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({
        user_id: fixtures.users.managerUser._id.toString(),
        shop_id: fixtures.shops.mainShop._id.toString(),
      });

    expectEnvelope(forbiddenRes, 403);
  });

  it('ATT-019: allows explicit rota selection during punch-in', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');
    const eligibleRota = await Rota.findOne({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
    }).sort({ shift_start: -1 });

    const verifyRes = await request(app)
      .post('/api/attendance/verify-location')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        latitude: 51.5074,
        longitude: -0.1278,
      });

    const punchRes = await request(app)
      .post('/api/attendance/punch-in')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .set('x-device-id', 'staff-device-001')
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        location_token: verifyRes.body.data.location_token,
        biometric_verified: true,
        rota_id: eligibleRota._id.toString(),
      });

    expectEnvelope(punchRes, 201);
    expect(punchRes.body.data.attendance.rota_id._id).toBe(eligibleRota._id.toString());
    expect(punchRes.body.data.attendance.auto_punch_out_at).toBeTruthy();
  });

  it('ATT-020: overdue open attendance is auto punched out on attendance read', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const oldPunchIn = new Date(Date.now() - 10 * 60 * 60 * 1000);
    const overdueAutoPunchAt = new Date(Date.now() - 30 * 60 * 1000);

    const stale = await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: oldPunchIn,
      auto_punch_out_at: overdueAutoPunchAt,
      is_manual: false,
      punch_method: 'GPS+Biometric',
    });

    const listRes = await request(app)
      .get('/api/attendance')
      .set('Authorization', `Bearer ${managerLogin.token}`);

    expectEnvelope(listRes, 200);

    const refreshed = await Attendance.findById(stale._id);
    expect(refreshed.punch_out).toBeTruthy();
    expect(refreshed.punch_out_source).toBe('Auto');
  });

  it('ATT-021: manager can trigger global overdue reconciliation', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date(Date.now() - 9 * 60 * 60 * 1000),
      auto_punch_out_at: new Date(Date.now() - 10 * 60 * 1000),
      is_manual: false,
      punch_method: 'GPS+Biometric',
    });

    const res = await request(app)
      .post('/api/attendance/reconcile-overdue')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({});

    expectEnvelope(res, 200);
    expect(typeof res.body.data.updated).toBe('number');
  });

  it('ATT-022: staff can trigger self overdue reconciliation only', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const staffAttendance = await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date(Date.now() - 9 * 60 * 60 * 1000),
      auto_punch_out_at: new Date(Date.now() - 10 * 60 * 1000),
      is_manual: false,
      punch_method: 'GPS+Biometric',
    });

    const managerAttendance = await Attendance.create({
      user_id: fixtures.users.managerUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date(Date.now() - 9 * 60 * 60 * 1000),
      auto_punch_out_at: new Date(Date.now() - 10 * 60 * 1000),
      is_manual: false,
      punch_method: 'GPS+Biometric',
    });

    const res = await request(app)
      .post('/api/attendance/reconcile-self')
      .set('Authorization', `Bearer ${staffLogin.token}`)
      .send({});

    expectEnvelope(res, 200);

    const refreshedStaff = await Attendance.findById(staffAttendance._id);
    const refreshedManager = await Attendance.findById(managerAttendance._id);
    expect(refreshedStaff.punch_out).toBeTruthy();
    expect(refreshedManager.punch_out).toBeNull();

    const managerSweep = await request(app)
      .post('/api/attendance/reconcile-overdue')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({});
    expectEnvelope(managerSweep, 200);
  });

  it('ATT-023: preview closed-attendance hour adjustment for selected date range', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    await Attendance.insertMany([
      {
        user_id: fixtures.users.staffUser._id,
        shop_id: fixtures.shops.mainShop._id,
        punch_in: new Date('2026-03-10T09:00:00.000Z'),
        punch_out: new Date('2026-03-10T17:00:00.000Z'),
        punch_method: 'GPS+Biometric',
      },
      {
        user_id: fixtures.users.staffUser._id,
        shop_id: fixtures.shops.mainShop._id,
        punch_in: new Date('2026-03-11T10:00:00.000Z'),
        punch_out: new Date('2026-03-11T14:00:00.000Z'),
        punch_method: 'GPS+Biometric',
      },
    ]);

    const res = await request(app)
      .post('/api/attendance/adjust-hours/preview')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        user_id: fixtures.users.staffUser._id.toString(),
        shop_id: fixtures.shops.mainShop._id.toString(),
        from_date: '2026-03-10',
        to_date: '2026-03-11',
        target_hours: 12,
      });

    expectEnvelope(res, 200);
    expect(res.body.data.actual_hours).toBe(12);
    expect(res.body.data.adjusted_hours).toBe(12);
    expect(res.body.data.reduced_hours).toBe(0);
    expect(res.body.data.records_count).toBe(2);
  });

  it('ATT-024: apply closed-attendance hour adjustment and persist adjusted minutes', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const records = await Attendance.insertMany([
      {
        user_id: fixtures.users.staffUser._id,
        shop_id: fixtures.shops.mainShop._id,
        punch_in: new Date('2026-03-15T09:00:00.000Z'),
        punch_out: new Date('2026-03-15T17:00:00.000Z'),
        punch_method: 'GPS+Biometric',
      },
      {
        user_id: fixtures.users.staffUser._id,
        shop_id: fixtures.shops.mainShop._id,
        punch_in: new Date('2026-03-16T09:00:00.000Z'),
        punch_out: new Date('2026-03-16T17:00:00.000Z'),
        punch_method: 'GPS+Biometric',
      },
    ]);

    const res = await request(app)
      .post('/api/attendance/adjust-hours/apply')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        user_id: fixtures.users.staffUser._id.toString(),
        shop_id: fixtures.shops.mainShop._id.toString(),
        from_date: '2026-03-15',
        to_date: '2026-03-16',
        target_hours: 16,
        note: 'Payroll correction',
      });

    expectEnvelope(res, 200);
    expect(res.body.data.actual_hours).toBe(16);
    expect(res.body.data.adjusted_hours).toBe(16);

    const first = await Attendance.findById(records[0]._id);
    const second = await Attendance.findById(records[1]._id);
    expect(first.adjusted_minutes).toBe(480);
    expect(second.adjusted_minutes).toBe(480);
    expect(second.adjustment_note).toBe('Payroll correction');
  });

  it('ATT-025: bulk-by-shop adjustment updates multiple employees in one request', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const extraStaff = await User.create({
      name: 'Extra Staff',
      email: 'extra.staff@org.com',
      password_hash: 'Extra@1234',
      role_id: fixtures.roles.staffRole._id,
      shop_id: fixtures.shops.mainShop._id,
      assigned_shop_ids: [fixtures.shops.mainShop._id],
      must_change_password: true,
    });

    await Attendance.insertMany([
      {
        user_id: fixtures.users.staffUser._id,
        shop_id: fixtures.shops.mainShop._id,
        punch_in: new Date('2026-03-18T09:00:00.000Z'),
        punch_out: new Date('2026-03-18T17:00:00.000Z'),
        punch_method: 'GPS+Biometric',
      },
      {
        user_id: extraStaff._id,
        shop_id: fixtures.shops.mainShop._id,
        punch_in: new Date('2026-03-18T08:00:00.000Z'),
        punch_out: new Date('2026-03-18T16:00:00.000Z'),
        punch_method: 'GPS+Biometric',
      },
    ]);

    const res = await request(app)
      .post('/api/attendance/adjust-hours/bulk-by-shop')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        from_date: '2026-03-18',
        to_date: '2026-03-18',
        adjustments: [
          {
            user_id: fixtures.users.staffUser._id.toString(),
            target_hours: 8,
          },
          {
            user_id: extraStaff._id.toString(),
            target_hours: 6,
          },
        ],
      });

    expectEnvelope(res, 200);
    expect(res.body.data.users_count).toBe(2);

    const adjusted = await Attendance.find({
      user_id: { $in: [fixtures.users.staffUser._id, extraStaff._id] },
      punch_in: { $gte: new Date('2026-03-18T00:00:00.000Z') },
      punch_out: { $ne: null },
    }).sort({ user_id: 1 });

    expect(adjusted.length).toBeGreaterThanOrEqual(2);
    const targetByUser = {
      [fixtures.users.staffUser._id.toString()]: 480,
      [extraStaff._id.toString()]: 360,
    };
    adjusted.forEach((record) => {
      expect(record.adjusted_minutes).toBe(targetByUser[record.user_id.toString()]);
      expect(record.effective_start).toBeTruthy();
      expect(record.effective_end).toBeTruthy();
      expect(record.effective_minutes).toBe(targetByUser[record.user_id.toString()]);
    });
  });

  it('ATT-026: bulk-by-shop adjustment fails when some users in date range are not selected', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const extraStaff = await User.create({
      name: 'Unselected Staff',
      email: 'unselected.staff@org.com',
      password_hash: 'Extra@1234',
      role_id: fixtures.roles.staffRole._id,
      shop_id: fixtures.shops.mainShop._id,
      assigned_shop_ids: [fixtures.shops.mainShop._id],
      must_change_password: true,
    });

    await Attendance.insertMany([
      {
        user_id: fixtures.users.staffUser._id,
        shop_id: fixtures.shops.mainShop._id,
        punch_in: new Date('2026-03-19T09:00:00.000Z'),
        punch_out: new Date('2026-03-19T17:00:00.000Z'),
        punch_method: 'GPS+Biometric',
      },
      {
        user_id: extraStaff._id,
        shop_id: fixtures.shops.mainShop._id,
        punch_in: new Date('2026-03-19T10:00:00.000Z'),
        punch_out: new Date('2026-03-19T18:00:00.000Z'),
        punch_method: 'GPS+Biometric',
      },
    ]);

    const res = await request(app)
      .post('/api/attendance/adjust-hours/bulk-by-shop')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        from_date: '2026-03-19',
        to_date: '2026-03-19',
        adjustments: [
          {
            user_id: fixtures.users.staffUser._id.toString(),
            target_hours: 7,
          },
        ],
      });

    expectEnvelope(res, 409);
    expect(Array.isArray(res.body.data.unchanged_users)).toBe(true);
    expect(res.body.data.unchanged_users.length).toBe(1);
    expect(res.body.data.unchanged_users[0].user_id).toBe(extraStaff._id.toString());
  });

  it('ATT-027: admin can fetch unchanged users for shop/date range', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date('2026-03-20T09:00:00.000Z'),
      punch_out: new Date('2026-03-20T16:00:00.000Z'),
      punch_method: 'GPS+Biometric',
    });

    const res = await request(app)
      .get('/api/attendance/adjust-hours/unchanged-users')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        shop_id: fixtures.shops.mainShop._id.toString(),
        from_date: '2026-03-20',
        to_date: '2026-03-20',
      });

    expectEnvelope(res, 200);
    expect(res.body.data.count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.data.users)).toBe(true);
  });

  it('ATT-028: coverage validation uses historical shop hours for past-date adjustments', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await Shop.findByIdAndUpdate(fixtures.shops.mainShop._id, {
      opening_time: '10:00',
      closing_time: '14:00',
      shop_time_history: [
        {
          opening_time: '08:00',
          closing_time: '14:00',
          effective_from: new Date('2026-03-01T00:00:00.000Z'),
          effective_to: new Date('2026-03-20T00:00:00.000Z'),
          changed_at: new Date('2026-03-01T00:00:00.000Z'),
        },
        {
          opening_time: '10:00',
          closing_time: '14:00',
          effective_from: new Date('2026-03-20T00:00:00.000Z'),
          effective_to: null,
          changed_at: new Date('2026-03-20T00:00:00.000Z'),
        },
      ],
    });

    await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date('2026-03-10T10:00:00.000Z'),
      punch_out: new Date('2026-03-10T14:00:00.000Z'),
      punch_method: 'GPS+Biometric',
    });

    const res = await request(app)
      .post('/api/attendance/adjust-hours/preview')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        user_id: fixtures.users.staffUser._id.toString(),
        shop_id: fixtures.shops.mainShop._id.toString(),
        from_date: '2026-03-10',
        to_date: '2026-03-10',
        target_hours: 4,
      });

    expectEnvelope(res, 409);
    expect(Array.isArray(res.body.data.gaps)).toBe(true);
    expect(res.body.data.gaps.length).toBeGreaterThan(0);
    expect(typeof res.body.data.total_missing_minutes).toBe('number');
    expect(res.body.data.total_missing_minutes).toBeGreaterThan(0);
    expect(typeof res.body.data.total_missing_hours).toBe('number');
    expect(Array.isArray(res.body.data.uncovered_windows_preview)).toBe(true);
    expect(typeof res.body.data.summary).toBe('string');
    expect(Array.isArray(res.body.data.possible_solutions)).toBe(true);
    expect(res.body.data.possible_solutions.length).toBeGreaterThan(0);
    expect(typeof res.body.data.required_coverage_hours).toBe('number');
    expect(typeof res.body.data.achievable_coverage_hours_after_adjustment).toBe('number');
    expect(typeof res.body.data.expected_missing_if_even_distribution_hours).toBe('number');
    expect(res.body.data.notes).toBeTruthy();
    expect(typeof res.body.data.notes.total_missing_hours).toBe('string');
    expect(typeof res.body.data.admin_hint).toBe('string');
  });

  it('ATT-029: non-root sees effective punch_in/out while root sees actual punch_in/out', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const rootLogin = await login('root@org.com', 'Root@1234');

    const record = await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date('2026-03-22T09:00:00.000Z'),
      punch_out: new Date('2026-03-22T17:00:00.000Z'),
      effective_start: new Date('2026-03-22T10:00:00.000Z'),
      effective_end: new Date('2026-03-22T16:00:00.000Z'),
      effective_minutes: 360,
      effective_source: 'Adjusted',
      punch_method: 'GPS+Biometric',
    });

    const adminRes = await request(app)
      .get(`/api/attendance?user_id=${fixtures.users.staffUser._id}`)
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(adminRes, 200);
    const adminRecord = adminRes.body.data.records.find(
      (item) => item._id === record._id.toString()
    );
    expect(adminRecord).toBeTruthy();
    expect(adminRecord.punch_in).toBe('2026-03-22T10:00:00.000Z');
    expect(adminRecord.punch_out).toBe('2026-03-22T16:00:00.000Z');

    const rootRes = await request(app)
      .get(`/api/attendance?user_id=${fixtures.users.staffUser._id}`)
      .set('Authorization', `Bearer ${rootLogin.token}`);

    expectEnvelope(rootRes, 200);
    const rootRecord = rootRes.body.data.records.find((item) => item._id === record._id.toString());
    expect(rootRecord).toBeTruthy();
    expect(rootRecord.punch_in).toBe('2026-03-22T09:00:00.000Z');
    expect(rootRecord.punch_out).toBe('2026-03-22T17:00:00.000Z');
  });

  it('ATT-030: manager view is capped to last 30 days while admin/root are not capped', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const rootLogin = await login('root@org.com', 'Root@1234');

    const olderThanThirty = new Date();
    olderThanThirty.setUTCDate(olderThanThirty.getUTCDate() - 45);
    const olderOut = new Date(olderThanThirty.getTime() + 2 * 60 * 60 * 1000);

    await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: olderThanThirty,
      punch_out: olderOut,
      punch_method: 'GPS+Biometric',
    });

    const managerRes = await request(app)
      .get('/api/attendance')
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(managerRes, 200);
    const managerHasOld = managerRes.body.data.records.some(
      (record) => new Date(record.punch_in).getTime() === olderThanThirty.getTime()
    );
    expect(managerHasOld).toBe(false);

    const adminRes = await request(app)
      .get('/api/attendance')
      .set('Authorization', `Bearer ${adminLogin.token}`);
    expectEnvelope(adminRes, 200);
    const adminHasOld = adminRes.body.data.records.some(
      (record) => new Date(record.punch_in).getTime() === olderThanThirty.getTime()
    );
    expect(adminHasOld).toBe(true);

    const rootRes = await request(app)
      .get('/api/attendance')
      .set('Authorization', `Bearer ${rootLogin.token}`);
    expectEnvelope(rootRes, 200);
    const rootHasOld = rootRes.body.data.records.some(
      (record) => new Date(record.punch_in).getTime() === olderThanThirty.getTime()
    );
    expect(rootHasOld).toBe(true);
  });

  it('ATT-031: admin and root can view attendance across shops', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const rootLogin = await login('root@org.com', 'Root@1234');

    const remoteShop = await Shop.create({
      name: 'Remote Branch',
      latitude: 52.4,
      longitude: -0.6,
      geofence_radius_m: 120,
      opening_time: '10:00',
      closing_time: '14:00',
    });

    const remoteUser = await User.create({
      name: 'Remote Staff',
      email: 'remote.staff@org.com',
      password_hash: 'Remote@1234',
      role_id: fixtures.roles.staffRole._id,
      shop_id: remoteShop._id,
      assigned_shop_ids: [remoteShop._id],
      must_change_password: true,
    });

    const remoteRecord = await Attendance.create({
      user_id: remoteUser._id,
      shop_id: remoteShop._id,
      punch_in: new Date(),
      punch_out: new Date(Date.now() + 2 * 60 * 60 * 1000),
      punch_method: 'GPS+Biometric',
    });

    const adminRes = await request(app)
      .get('/api/attendance')
      .set('Authorization', `Bearer ${adminLogin.token}`);
    expectEnvelope(adminRes, 200);
    const adminSeesRemote = adminRes.body.data.records.some(
      (record) => record._id === remoteRecord._id.toString()
    );
    expect(adminSeesRemote).toBe(true);

    const rootRes = await request(app)
      .get('/api/attendance')
      .set('Authorization', `Bearer ${rootLogin.token}`);
    expectEnvelope(rootRes, 200);
    const rootSeesRemote = rootRes.body.data.records.some(
      (record) => record._id === remoteRecord._id.toString()
    );
    expect(rootSeesRemote).toBe(true);
  });

  it('ATT-032: admin can query attendance by explicit shop_id even without assigned shops', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await User.findByIdAndUpdate(fixtures.users.adminUser._id, {
      assigned_shop_ids: [],
      shop_id: null,
      active_shop_id: null,
    });

    const record = await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date(),
      punch_out: new Date(Date.now() + 60 * 60 * 1000),
      punch_method: 'GPS+Biometric',
    });

    const res = await request(app)
      .get(`/api/attendance?shop_id=${fixtures.shops.mainShop._id}`)
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(res, 200);
    const hit = res.body.data.records.find((item) => item._id === record._id.toString());
    expect(hit).toBeTruthy();
  });

  it('ATT-033: admin with no shop and no global perms can still view all-shop attendance with effective time mapping', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await User.findByIdAndUpdate(fixtures.users.adminUser._id, {
      assigned_shop_ids: [],
      shop_id: null,
      active_shop_id: null,
    });
    await Role.findByIdAndUpdate(fixtures.roles.adminRole._id, {
      $set: {
        // Simulate production misconfiguration where Admin permissions are reduced.
        'permissions.can_manage_shops': false,
        'permissions.can_manage_roles': false,
        'permissions.can_view_all_staff': false,
      },
    });

    const adjustedRecord = await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date('2026-03-22T09:00:00.000Z'),
      punch_out: new Date('2026-03-22T17:00:00.000Z'),
      effective_start: new Date('2026-03-22T10:00:00.000Z'),
      effective_end: new Date('2026-03-22T16:00:00.000Z'),
      effective_minutes: 360,
      effective_source: 'Adjusted',
      punch_method: 'GPS+Biometric',
    });

    await Attendance.create({
      user_id: fixtures.users.managerUser._id,
      shop_id: fixtures.shops.eastShop._id,
      punch_in: new Date(),
      punch_out: new Date(Date.now() + 30 * 60 * 1000),
      punch_method: 'GPS+Biometric',
    });

    const res = await request(app)
      .get('/api/attendance?page=1&limit=50')
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(res, 200);
    const seesMain = res.body.data.records.some(
      (item) => item.shop_id?._id === fixtures.shops.mainShop._id.toString()
    );
    const seesEast = res.body.data.records.some(
      (item) => item.shop_id?._id === fixtures.shops.eastShop._id.toString()
    );
    expect(seesMain).toBe(true);
    expect(seesEast).toBe(true);

    const adjustedDto = res.body.data.records.find(
      (item) => item._id === adjustedRecord._id.toString()
    );
    expect(adjustedDto).toBeTruthy();
    expect(adjustedDto.punch_in).toBe('2026-03-22T10:00:00.000Z');
    expect(adjustedDto.punch_out).toBe('2026-03-22T16:00:00.000Z');
  });

  it('ATT-034: lowercase admin role_name still gets admin attendance visibility', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await Role.findByIdAndUpdate(fixtures.roles.adminRole._id, {
      $set: {
        role_name: 'admin',
        'permissions.can_manage_shops': false,
        'permissions.can_manage_roles': false,
        'permissions.can_view_all_staff': false,
      },
    });
    await User.findByIdAndUpdate(fixtures.users.adminUser._id, {
      assigned_shop_ids: [],
      shop_id: null,
      active_shop_id: null,
    });

    await Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date(),
      punch_out: new Date(Date.now() + 45 * 60 * 1000),
      punch_method: 'GPS+Biometric',
    });

    const res = await request(app)
      .get('/api/attendance?page=1&limit=10')
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.total).toBeGreaterThan(0);
  });

  it('ATT-035: summary-by-user groups attendance and returns total work hours', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await Attendance.insertMany([
      {
        user_id: fixtures.users.staffUser._id,
        shop_id: fixtures.shops.mainShop._id,
        punch_in: new Date('2026-03-26T09:00:00.000Z'),
        punch_out: new Date('2026-03-26T17:00:00.000Z'),
        effective_start: new Date('2026-03-26T10:00:00.000Z'),
        effective_end: new Date('2026-03-26T16:00:00.000Z'),
        effective_minutes: 360,
        effective_source: 'Adjusted',
        punch_method: 'GPS+Biometric',
      },
      {
        user_id: fixtures.users.managerUser._id,
        shop_id: fixtures.shops.mainShop._id,
        punch_in: new Date('2026-03-26T08:00:00.000Z'),
        punch_out: new Date('2026-03-26T12:00:00.000Z'),
        punch_method: 'GPS+Biometric',
      },
    ]);

    const res = await request(app)
      .get('/api/attendance/summary-by-user')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({
        shop_id: fixtures.shops.mainShop._id.toString(),
        from_date: '2026-03-01T00:00:00.000Z',
        to_date: '2026-04-30T00:00:00.000Z',
      });

    expectEnvelope(res, 200);
    expect(Array.isArray(res.body.data.users)).toBe(true);

    const staffSummary = res.body.data.users.find(
      (item) => item.user_id === fixtures.users.staffUser._id.toString()
    );
    const managerSummary = res.body.data.users.find(
      (item) => item.user_id === fixtures.users.managerUser._id.toString()
    );

    expect(staffSummary).toBeTruthy();
    expect(managerSummary).toBeTruthy();
    expect(staffSummary.total_work_hours).toBe(6);
    expect(staffSummary.total_actual_hours).toBe(8);
    expect(managerSummary.total_work_hours).toBe(4);
    expect(managerSummary.total_actual_hours).toBe(4);
  });
});
