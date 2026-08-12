/**
 * Manager/Admin/Sub-Manager abilities:
 *   - PUT /api/attendance/:id/correct  (fix clock-in/out after auto punch-out)
 *   - DELETE /api/users/:id            (deactivate staff who left)
 * Covers permission gating, shop-scope enforcement, and validation.
 */
const request = require('supertest');
const app = require('../../src/app');
const Attendance = require('../../src/models/Attendance');
const Shop = require('../../src/models/Shop');
const User = require('../../src/models/User');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('Attendance correction & staff deactivation', () => {
  let fixtures;
  let outsideShop;
  let outsideStaff;

  const createClosedAttendance = (overrides = {}) =>
    Attendance.create({
      user_id: fixtures.users.staffUser._id,
      shop_id: fixtures.shops.mainShop._id,
      punch_in: new Date('2026-03-16T09:00:00.000Z'),
      punch_out: new Date('2026-03-16T19:00:00.000Z'),
      punch_out_source: 'Auto',
      punch_method: 'GPS+Biometric',
      ...overrides,
    });

  beforeAll(async () => {
    await connectSandboxDb();
  });

  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();

    // A shop no manager/sub-manager in the fixtures is assigned to.
    outsideShop = await Shop.create({
      name: 'North Branch',
      latitude: 51.6,
      longitude: -0.2,
      geofence_radius_m: 120,
      opening_time: '08:00',
      closing_time: '22:00',
    });
    outsideStaff = await User.create({
      name: 'Erin Outside',
      email: 'outside@org.com',
      phone_code: '+44',
      phone_num: '7000000005',
      password_hash: 'Outside@1234',
      role_id: fixtures.roles.staffRole._id,
      shop_id: outsideShop._id,
      assigned_shop_ids: [outsideShop._id],
    });
  });

  afterAll(async () => {
    await disconnectSandboxDb();
  });

  // ─── Attendance correction ───────────────────────────────

  it('CORRECT-001: manager corrects an auto punched-out shift', async () => {
    const record = await createClosedAttendance();
    const manager = await login('manager@org.com', 'Manager@1234');

    const res = await request(app)
      .put(`/api/attendance/${record._id}/correct`)
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ punch_out: '2026-03-16T17:00:00.000Z', note: 'Auto punch-out was late' });

    expectEnvelope(res, 200);
    const updated = res.body.data.attendance;
    expect(new Date(updated.punch_out).toISOString()).toBe('2026-03-16T17:00:00.000Z');
    expect(updated.punch_out_source).toBe('Manual');
    expect(updated.corrected_by).toBeTruthy();

    const stored = await Attendance.findById(record._id);
    expect(stored.original_punch_out.toISOString()).toBe('2026-03-16T19:00:00.000Z');
    expect(stored.correction_note).toBe('Auto punch-out was late');
  });

  it('CORRECT-002: staff cannot correct attendance (missing permission)', async () => {
    const record = await createClosedAttendance();
    const staff = await login('staff@org.com', 'Staff@1234');

    const res = await request(app)
      .put(`/api/attendance/${record._id}/correct`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ punch_out: '2026-03-16T17:00:00.000Z' });

    expectEnvelope(res, 403);
  });

  it('CORRECT-003: rejects punch_out before punch_in', async () => {
    const record = await createClosedAttendance();
    const manager = await login('manager@org.com', 'Manager@1234');

    const res = await request(app)
      .put(`/api/attendance/${record._id}/correct`)
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ punch_out: '2026-03-16T08:00:00.000Z' });

    expectEnvelope(res, 400);
  });

  it('CORRECT-004: sub-manager cannot correct a record outside assigned shops', async () => {
    const record = await createClosedAttendance({
      user_id: outsideStaff._id,
      shop_id: outsideShop._id,
    });
    const subManager = await login('submanager@org.com', 'SubMgr@1234');

    const res = await request(app)
      .put(`/api/attendance/${record._id}/correct`)
      .set('Authorization', `Bearer ${subManager.token}`)
      .send({ punch_out: '2026-03-16T17:00:00.000Z' });

    expectEnvelope(res, 403);
  });

  // ─── Staff deactivation ──────────────────────────────────

  it('DELETE-001: manager deactivates a staff member in their shop', async () => {
    const manager = await login('manager@org.com', 'Manager@1234');

    const res = await request(app)
      .delete(`/api/users/${fixtures.users.staffUser._id}`)
      .set('Authorization', `Bearer ${manager.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.user.is_active).toBe(false);
    const stored = await User.findById(fixtures.users.staffUser._id);
    expect(stored.is_active).toBe(false);
  });

  it('DELETE-002: sub-manager cannot deactivate an Admin', async () => {
    const subManager = await login('submanager@org.com', 'SubMgr@1234');

    const res = await request(app)
      .delete(`/api/users/${fixtures.users.adminUser._id}`)
      .set('Authorization', `Bearer ${subManager.token}`);

    expectEnvelope(res, 403);
  });

  it('DELETE-003: manager cannot deactivate staff outside their assigned shops', async () => {
    const manager = await login('manager@org.com', 'Manager@1234');

    const res = await request(app)
      .delete(`/api/users/${outsideStaff._id}`)
      .set('Authorization', `Bearer ${manager.token}`);

    expectEnvelope(res, 403);
  });

  it('DELETE-004: staff cannot deactivate anyone (missing permission)', async () => {
    const staff = await login('staff@org.com', 'Staff@1234');

    const res = await request(app)
      .delete(`/api/users/${outsideStaff._id}`)
      .set('Authorization', `Bearer ${staff.token}`);

    expectEnvelope(res, 403);
  });
});
