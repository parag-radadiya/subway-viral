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

  it('splits a >max target into multiple shifts, each within limits, no writes', async () => {
    // Shop 08:00–18:00 (10h/day); a single user covering both days = 20h,
    // which must split into two ≤10h shifts (one per day).
    await Shop.findByIdAndUpdate(fixtures.shops.mainShop._id, {
      opening_time: '08:00',
      closing_time: '18:00',
    });
    const staff = await mkStaff('split@org.com');
    const res = await request(app)
      .post(PREVIEW)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shop_id: shopId,
        from_date: '2026-06-01',
        to_date: '2026-06-02', // two 10h windows = 20h coverage
        adjustments: [{ user_id: staff, target_hours: 20 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.can_apply).toBe(true);
    const user = res.body.data.users[0];
    expect(user.shift_count).toBe(2);
    user.shifts.forEach((s) => expect(s.hours).toBeLessThanOrEqual(10));
    user.shifts.forEach((s) => expect(s.hours).toBeGreaterThanOrEqual(4));
    expect(user.allocated_hours).toBe(20);
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

  it('tiles two users to cover the window exactly when total == coverage (no overlap needed)', async () => {
    const a = await mkStaff('a@org.com');
    const b = await mkStaff('b@org.com');
    const res = await request(app)
      .post(APPLY)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shop_id: shopId,
        from_date: '2026-06-01',
        to_date: '2026-06-01', // one 12h window; 8 + 4 = 12h = coverage
        adjustments: [
          { user_id: a, target_hours: 8 },
          { user_id: b, target_hours: 4 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.applied).toBe(true);
    expect(res.body.data.can_apply).toBe(true);
    expect(res.body.data.has_gaps).toBe(false); // full coverage
    expect(res.body.data.batch_id).toBeTruthy();

    const recs = await Attendance.find({ shop_id: shopId, is_active: { $ne: false } }).sort({
      punch_in: 1,
    });
    expect(recs).toHaveLength(2);
    // Total equals coverage, so phase 1 tiles them back-to-back (single presence).
    expect(new Date(recs[0].punch_out) <= new Date(recs[1].punch_in)).toBe(true);
    const aRec = recs.find((r) => String(r.user_id) === a);
    const bRec = recs.find((r) => String(r.user_id) === b);
    expect(aRec.effective_minutes).toBe(480);
    expect(bRec.effective_minutes).toBe(240);
  });

  it('records the FULL requested hours across users even beyond shop open capacity', async () => {
    // Shop open 08:00–18:00 (10h/day) × 5 days = 50h of open time.
    // Two users asking 40h + 30h = 70h must ALL be recorded (overlap allowed),
    // not capped at the 50h open duration.
    await Shop.findByIdAndUpdate(fixtures.shops.mainShop._id, {
      opening_time: '08:00',
      closing_time: '18:00',
    });
    const a = await mkStaff('big-a@org.com');
    const b = await mkStaff('big-b@org.com');
    const res = await request(app)
      .post(APPLY)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shop_id: shopId,
        from_date: '2026-06-01',
        to_date: '2026-06-05', // 5 × 10h windows = 50h capacity
        adjustments: [
          { user_id: a, target_hours: 40 },
          { user_id: b, target_hours: 30 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.applied).toBe(true);

    const aMins = (await Attendance.find({ user_id: a, is_active: { $ne: false } })).reduce(
      (sum, r) => sum + r.effective_minutes,
      0
    );
    const bMins = (await Attendance.find({ user_id: b, is_active: { $ne: false } })).reduce(
      (sum, r) => sum + r.effective_minutes,
      0
    );
    expect(aMins).toBe(40 * 60);
    expect(bMins).toBe(30 * 60);
    expect(aMins + bMins).toBe(70 * 60); // full 70h recorded, not capped at 50h
  });

  it('does not strand sub-min remainders: multi-user week records every hour, no 409', async () => {
    // Regression for the real report: 40/30/15/0/35 over a 7-day, 12h/day shop.
    // Balanced splitting + remainder absorption must place every hour (no stray
    // sub-4h leftover triggering UNALLOCATED_TARGET_HOURS).
    await Shop.findByIdAndUpdate(fixtures.shops.mainShop._id, {
      opening_time: '08:00',
      closing_time: '20:00',
    });
    const targets = [40, 30, 15, 0, 35];
    const ids = [];
    for (let i = 0; i < targets.length; i += 1) {
      ids.push(await mkStaff(`week-${i}@org.com`));
    }
    const res = await request(app)
      .post(APPLY)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shop_id: shopId,
        from_date: '2026-08-02',
        to_date: '2026-08-08', // 7 × 12h windows = 84h coverage
        adjustments: ids.map((user_id, i) => ({ user_id, target_hours: targets[i] })),
      });

    expect(res.status).toBe(200);
    expect(res.body.data.applied).toBe(true);
    expect(res.body.data.has_gaps).toBe(false); // shop fully covered

    // Every user's full target is recorded, and every shift respects 4h–10h.
    for (let i = 0; i < ids.length; i += 1) {
      const recs = await Attendance.find({ user_id: ids[i], is_active: { $ne: false } });
      const mins = recs.reduce((sum, r) => sum + r.effective_minutes, 0);
      expect(mins).toBe(targets[i] * 60);
      recs.forEach((r) => {
        expect(r.effective_minutes).toBeLessThanOrEqual(10 * 60);
        expect(r.effective_minutes).toBeGreaterThanOrEqual(4 * 60);
      });
    }
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

  it('409s when a single user target cannot fit the available open hours under max', async () => {
    // One user asking 12h with only one 12h day and max 10h/shift cannot be
    // fully placed — we reject rather than silently dropping the remainder.
    const staff = await mkStaff('gap@org.com');
    const res = await request(app)
      .post(APPLY)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shop_id: shopId,
        from_date: '2026-06-01',
        to_date: '2026-06-01', // one 12h window, one user, max 10h/shift
        adjustments: [{ user_id: staff, target_hours: 12 }],
      });
    expect(res.status).toBe(409);
    expect(res.body.data.error_code).toBe('UNALLOCATED_TARGET_HOURS');
    expect(res.body.data.can_apply).toBe(false);
    // nothing is written on a blocked request
    expect(await Attendance.countDocuments({ user_id: staff })).toBe(0);
  });

  it('409s when a single user target exceeds total available open hours', async () => {
    // Shop open 08:00–18:00 (10h/day) × 3 days = 30h; one user asks 40h.
    await Shop.findByIdAndUpdate(fixtures.shops.mainShop._id, {
      opening_time: '08:00',
      closing_time: '18:00',
    });
    const staff = await mkStaff('too-much@org.com');
    const res = await request(app)
      .post(APPLY)
      .set('Authorization', `Bearer ${token}`)
      .send({
        shop_id: shopId,
        from_date: '2026-06-01',
        to_date: '2026-06-03', // 3 × 10h = 30h available
        adjustments: [{ user_id: staff, target_hours: 40 }],
      });
    expect(res.status).toBe(409);
    expect(res.body.data.error_code).toBe('UNALLOCATED_TARGET_HOURS');
    expect(await Attendance.countDocuments({ user_id: staff })).toBe(0);
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
