const request = require('supertest');
const app = require('../../src/app');
const Attendance = require('../../src/models/Attendance');
const Rota = require('../../src/models/Rota');
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
});
