/**
 * bulk-by-shop adjustment — min/max shift limits, multi-shift split, single
 * presence, gap reporting, and the new preview endpoint.
 *
 * Shop is set to 08:00–20:00 (a 12h/day window) so scenarios are easy to reason
 * about. Defaults: min 4h, max 10h (overridable via min_shift_hours/max_shift_hours).
 */
const request = require('supertest');
const app = require('../../src/app');
const Attendance = require('../../src/models/Attendance');
const Shop = require('../../src/models/Shop');
const User = require('../../src/models/User');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

const PREVIEW = '/api/attendance/adjust-hours/bulk-by-shop/preview';
const APPLY = '/api/attendance/adjust-hours/bulk-by-shop';

describe('bulk-by-shop min/max shift limits', () => {
  let fixtures;
  let token;
  let shopId;

  async function mkStaff(email) {
    const u = await User.create({
      name: email,
      email,
      password_hash: 'Staff@1234',
      role_id: fixtures.roles.staffRole._id,
      shop_id: fixtures.shops.mainShop._id,
      assigned_shop_ids: [fixtures.shops.mainShop._id],
      must_change_password: true,
    });
    return u._id.toString();
  }

  const noOverlap = (shifts) => {
    const s = [...shifts].sort((a, b) => new Date(a.punch_in) - new Date(b.punch_in));
    for (let i = 1; i < s.length; i++) {
      if (new Date(s[i].punch_in) < new Date(s[i - 1].punch_out)) return false;
    }
    return true;
  };

  beforeAll(async () => {
    await connectSandboxDb();
  });
  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();
    await Shop.findByIdAndUpdate(fixtures.shops.mainShop._id, {
      opening_time: '08:00',
      closing_time: '20:00',
    });
    shopId = fixtures.shops.mainShop._id.toString();
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    token = adminLogin.token;
  });
  afterAll(async () => {
    await disconnectSandboxDb();
  });

  it('preview splits an 18h target into multiple shifts, each within max (10h), no writes', async () => {
    const staff = await mkStaff('split@org.com');
    const res = await request(app)
      .post(PREVIEW)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shop_id: shopId,
        from_date: '2026-06-01',
        to_date: '2026-06-02', // two 12h windows
        adjustments: [{ user_id: staff, target_hours: 18 }],
      });

    expect(res.status).toBe(200);
    const user = res.body.data.users[0];
    expect(user.shift_count).toBe(2); // 10h + 8h
    user.shifts.forEach((s) => expect(s.hours).toBeLessThanOrEqual(10));
    user.shifts.forEach((s) => expect(s.hours).toBeGreaterThanOrEqual(4));
    expect(user.allocated_hours).toBe(18);
    expect(user.unallocated_hours).toBe(0);
    expect(noOverlap(user.shifts)).toBe(true);

    // preview writes nothing
    expect(await Attendance.countDocuments({ user_id: staff })).toBe(0);
  });

  it('a single target that fits in one shift stays one shift', async () => {
    const staff = await mkStaff('single@org.com');
    const res = await request(app)
      .post(PREVIEW)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shop_id: shopId,
        from_date: '2026-06-01',
        to_date: '2026-06-02',
        adjustments: [{ user_id: staff, target_hours: 8 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.users[0].shift_count).toBe(1);
    expect(res.body.data.users[0].shifts[0].hours).toBe(8);
  });

  it('apply is feasible and single-staffed when two users tile the window exactly', async () => {
    const a = await mkStaff('a@org.com');
    const b = await mkStaff('b@org.com');
    const res = await request(app)
      .post(APPLY)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shop_id: shopId,
        from_date: '2026-06-01',
        to_date: '2026-06-01', // one 12h window
        adjustments: [
          { user_id: a, target_hours: 8 },
          { user_id: b, target_hours: 4 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.applied).toBe(true);
    expect(res.body.data.can_apply).toBe(true);
    expect(res.body.data.has_gaps).toBe(false);
    expect(res.body.data.batch_id).toBeTruthy();

    const recs = await Attendance.find({ shop_id: shopId, is_active: { $ne: false } }).sort({
      punch_in: 1,
    });
    expect(recs).toHaveLength(2);
    // no user has overlapping records, and the two are back-to-back (single presence)
    expect(new Date(recs[0].punch_out) <= new Date(recs[1].punch_in)).toBe(true);
    const aRec = recs.find((r) => String(r.user_id) === a);
    expect(aRec.effective_minutes).toBe(480);
  });

  it('max_shift_hours override caps each shift', async () => {
    const staff = await mkStaff('cap@org.com');
    const res = await request(app)
      .post(PREVIEW)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shop_id: shopId,
        from_date: '2026-06-01',
        to_date: '2026-06-02',
        adjustments: [{ user_id: staff, target_hours: 12 }],
        max_shift_hours: 6,
      });
    expect(res.status).toBe(200);
    expect(res.body.data.limits.max_shift_hours).toBe(6);
    res.body.data.users[0].shifts.forEach((s) => expect(s.hours).toBeLessThanOrEqual(6));
  });

  it('apply still succeeds (200) but reports a gap warning when one user cannot cover the window under max', async () => {
    // Backward-compatible: coverage gaps caused purely by the min/max limits are
    // applied and reported as warnings, not a 409 — the current flow keeps working.
    const staff = await mkStaff('gap@org.com');
    const res = await request(app)
      .post(APPLY)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shop_id: shopId,
        from_date: '2026-06-01',
        to_date: '2026-06-01', // 12h window, one user, max 10h → 2h gap
        adjustments: [{ user_id: staff, target_hours: 12 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.applied).toBe(true);
    expect(res.body.data.has_gaps).toBe(true);
    const codes = res.body.data.warnings.map((w) => w.error_code);
    expect(codes).toContain('COVERAGE_GAP_AFTER_ADJUSTMENT');
    // the coverable portion (one 10h shift) IS written
    const recs = await Attendance.find({ user_id: staff, is_active: { $ne: false } });
    expect(recs).toHaveLength(1);
    expect(recs[0].effective_minutes).toBe(600);
  });

  it('still 409s when total target hours are below required coverage (unchanged pre-existing rule)', async () => {
    const staff = await mkStaff('low@org.com');
    const res = await request(app)
      .post(APPLY)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shop_id: shopId,
        from_date: '2026-06-01',
        to_date: '2026-06-01', // needs 12h coverage
        adjustments: [{ user_id: staff, target_hours: 5 }],
      });
    expect(res.status).toBe(409);
    expect(res.body.data.error_code).toBe('INSUFFICIENT_TARGET_HOURS_FOR_COVERAGE');
  });

  it('validates min_shift_hours <= max_shift_hours', async () => {
    const staff = await mkStaff('bad@org.com');
    const res = await request(app)
      .post(PREVIEW)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shop_id: shopId,
        from_date: '2026-06-01',
        to_date: '2026-06-01',
        adjustments: [{ user_id: staff, target_hours: 8 }],
        min_shift_hours: 9,
        max_shift_hours: 6,
      });
    expect(res.status).toBe(400);
  });
});
