/**
 * Bulk rota create — partial-publish investigation suite.
 *
 * These tests reproduce and document the real-world reports that "some days
 * publish and some don't" (e.g. Mon–Fri appear but Saturday/Sunday do not),
 * and every other way the bulk endpoint can silently create fewer rotas than
 * the manager expected.
 *
 * They are additive and do NOT modify production code. They run against an
 * in-memory MongoDB (mongodb-memory-server) — never a live database.
 *
 * Run:
 *   npx jest tests/integration/rotas-bulk-partial-publish.test.js
 */
const request = require('supertest');
const app = require('../../src/app');
const Rota = require('../../src/models/Rota');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

// ── date helpers ────────────────────────────────────────────────────────────
function nextMonday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const dow = d.getUTCDay();
  const daysUntilMon = dow === 0 ? 1 : dow === 1 ? 7 : 8 - dow;
  d.setUTCDate(d.getUTCDate() + daysUntilMon);
  return d;
}
function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
function combine(date, time) {
  const [h, m] = String(time).split(':').map(Number);
  const d = new Date(date);
  d.setUTCHours(h, m, 0, 0);
  return d;
}
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]; // 0 = Mon … 6 = Sun

describe('Bulk rota — partial publish / silent-drop investigation', () => {
  let fixtures;
  let mon;
  let monStr;
  let shopId;
  let staffId;
  let token;

  async function bulk(body) {
    return request(app)
      .post('/api/rotas/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }
  function createdDaysUTC(rotas) {
    return [...new Set(rotas.map((r) => new Date(r.shift_date).getUTCDay()))].sort();
  }

  beforeAll(async () => {
    await connectSandboxDb();
  });
  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();
    // seedTestData creates two rotas for staffUser in March 2026 that would
    // pollute overlap checks; clear rotas so every test starts from a clean slate.
    await Rota.deleteMany({});
    mon = nextMonday();
    monStr = fmtDate(mon);
    shopId = fixtures.shops.mainShop._id.toString();
    staffId = fixtures.users.staffUser._id.toString();
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    token = managerLogin.token;
  });
  afterAll(async () => {
    await disconnectSandboxDb();
  });

  // ── Baseline ──────────────────────────────────────────────────────────────
  it('BASELINE: fresh full week (Mon–Sun) creates all 7 days', async () => {
    const res = await bulk({
      shop_id: shopId,
      week_start: monStr,
      days: ALL_DAYS,
      assignments: [{ user_id: staffId, start_time: '09:00', end_time: '17:00' }],
    });
    expectEnvelope(res, 201);
    expect(res.body.data.created).toBe(7);
    expect(res.body.data.skipped).toBe(0);
    expect(res.body.data.conflicts).toHaveLength(0);

    const all = await Rota.find({ user_id: staffId });
    expect(createdDaysUTC(all)).toEqual([0, 1, 2, 3, 4, 5, 6]); // Sun..Sat present
  });

  // ── THE CLIENT COMPLAINT: Mon–Fri publish, Sat/Sun do not ──────────────────
  it('REPRO: weekend already exists → re-publishing full week creates Mon–Fri, silently skips Sat & Sun', async () => {
    // Step 1 — a previous publish already created Saturday & Sunday.
    const sat = addDays(mon, 5);
    const sun = addDays(mon, 6);
    await Rota.create({
      user_id: staffId,
      shop_id: shopId,
      shift_start: combine(sat, '09:00'),
      shift_end: combine(sat, '17:00'),
    });
    await Rota.create({
      user_id: staffId,
      shop_id: shopId,
      shift_start: combine(sun, '09:00'),
      shift_end: combine(sun, '17:00'),
    });

    // Step 2 — manager re-publishes the WHOLE week, same times, no replace.
    const res = await bulk({
      shop_id: shopId,
      week_start: monStr,
      days: ALL_DAYS,
      replace_existing: false,
      assignments: [{ user_id: staffId, start_time: '09:00', end_time: '17:00' }],
    });

    expectEnvelope(res, 201);
    // Mon–Fri are new (created); Sat & Sun collide with the existing rows.
    expect(res.body.data.created).toBe(5);
    expect(res.body.data.skipped).toBe(2);
    // The two skipped days ARE the weekend — this is the exact symptom.
    const skippedDays = res.body.data.conflicts.map((c) =>
      new Date(c.date).getUTCDay()
    );
    expect(skippedDays.sort()).toEqual([0, 6]); // Sun(0) & Sat(6)
    res.body.data.conflicts.forEach((c) =>
      expect(c.reason).toMatch(/overlap/i)
    );
  });

  it('WORKAROUND: same scenario with replace_existing:true republishes all 7 days', async () => {
    const sat = addDays(mon, 5);
    await Rota.create({
      user_id: staffId,
      shop_id: shopId,
      shift_start: combine(sat, '09:00'),
      shift_end: combine(sat, '17:00'),
    });
    const res = await bulk({
      shop_id: shopId,
      week_start: monStr,
      days: ALL_DAYS,
      replace_existing: true,
      assignments: [{ user_id: staffId, start_time: '09:00', end_time: '17:00' }],
    });
    expectEnvelope(res, 201);
    expect(res.body.data.created).toBe(7);
    expect(res.body.data.skipped).toBe(0);
  });

  it('REPRO: re-publishing an already-complete week creates 0 (everything skipped as overlap)', async () => {
    const first = await bulk({
      shop_id: shopId,
      week_start: monStr,
      days: ALL_DAYS,
      assignments: [{ user_id: staffId, start_time: '09:00', end_time: '17:00' }],
    });
    expect(first.body.data.created).toBe(7);

    const second = await bulk({
      shop_id: shopId,
      week_start: monStr,
      days: ALL_DAYS,
      assignments: [{ user_id: staffId, start_time: '09:00', end_time: '17:00' }],
    });
    expectEnvelope(second, 201);
    expect(second.body.data.created).toBe(0);
    expect(second.body.data.skipped).toBe(7);
  });

  // ── Cross-shop overlap silently blocks a day ───────────────────────────────
  it('REPRO: an existing shift at ANOTHER shop blocks that day at this shop (cross-shop overlap)', async () => {
    const wed = addDays(mon, 2);
    // staff already scheduled Wednesday at the East branch.
    await Rota.create({
      user_id: staffId,
      shop_id: fixtures.shops.eastShop._id,
      shift_start: combine(wed, '09:00'),
      shift_end: combine(wed, '17:00'),
    });
    const res = await bulk({
      shop_id: shopId, // Main branch
      week_start: monStr,
      days: ALL_DAYS,
      assignments: [{ user_id: staffId, start_time: '09:00', end_time: '17:00' }],
    });
    expectEnvelope(res, 201);
    // Wednesday is skipped even though it's a DIFFERENT shop.
    expect(res.body.data.created).toBe(6);
    expect(res.body.data.skipped).toBe(1);
    expect(new Date(res.body.data.conflicts[0].date).getUTCDay()).toBe(3); // Wed
  });

  // ── Silent past-date drop (start of week vanishes) ─────────────────────────
  it('REPRO: publishing the current week mid-week silently drops earlier days with NO conflict reported', async () => {
    // Freeze "today" to a Wednesday and publish that same Mon–Sun week.
    const wednesday = new Date('2026-08-12T10:00:00.000Z'); // 2026-08-12 is a Wed
    const weekMondayStr = '2026-08-10'; // Mon of that week
    jest.useFakeTimers({
      now: wednesday,
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'queueMicrotask',
        'hrtime',
        'performance',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
      ],
    });
    try {
      const freshLogin = await login('manager@org.com', 'Manager@1234');
      const res = await request(app)
        .post('/api/rotas/bulk')
        .set('Authorization', `Bearer ${freshLogin.token}`)
        .send({
          shop_id: shopId,
          week_start: weekMondayStr,
          days: ALL_DAYS, // Mon–Sun
          assignments: [{ user_id: staffId, start_time: '09:00', end_time: '17:00' }],
        });
      expectEnvelope(res, 201);
      // Wed, Thu, Fri, Sat, Sun = 5. Mon & Tue are in the past → dropped.
      expect(res.body.data.created).toBe(5);
      // The silent-failure smoking gun: the 2 lost days are NOT reported anywhere.
      expect(res.body.data.skipped).toBe(0);
      expect(res.body.data.conflicts).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  // ── ISO datetime collapses an assignment to a single day ───────────────────
  it('REPRO: sending start_time as a full ISO datetime applies the assignment to ONE day only', async () => {
    const res = await bulk({
      shop_id: shopId,
      week_start: monStr,
      days: ALL_DAYS, // manager selected all 7 days
      assignments: [
        {
          user_id: staffId,
          // Full ISO string (not "09:00") → silently becomes "specific date" mode.
          start_time: `${monStr}T09:00:00.000Z`,
          end_time: `${monStr}T17:00:00.000Z`,
        },
      ],
    });
    expectEnvelope(res, 201);
    // Only Monday is created despite all 7 days being selected.
    expect(res.body.data.created).toBe(1);
    const all = await Rota.find({ user_id: staffId });
    expect(createdDaysUTC(all)).toEqual([1]); // Mon only
  });

  // ── Overnight shifts do NOT drop the weekend (rules out a wrong theory) ─────
  it('CONTROL: overnight 18:00–04:00 across the full week still creates all 7 days', async () => {
    const res = await bulk({
      shop_id: shopId,
      week_start: monStr,
      days: ALL_DAYS,
      assignments: [{ user_id: staffId, start_time: '18:00', end_time: '04:00' }],
    });
    expectEnvelope(res, 201);
    expect(res.body.data.created).toBe(7);
    expect(res.body.data.skipped).toBe(0);
  });

  // ── Weekend-only publish maps indices correctly ────────────────────────────
  it('CONTROL: weekend-only days [5,6] creates exactly Saturday & Sunday', async () => {
    const res = await bulk({
      shop_id: shopId,
      week_start: monStr,
      days: [5, 6],
      assignments: [{ user_id: staffId, start_time: '09:00', end_time: '17:00' }],
    });
    expectEnvelope(res, 201);
    expect(res.body.data.created).toBe(2);
    const all = await Rota.find({ user_id: staffId });
    expect(createdDaysUTC(all)).toEqual([0, 6]); // Sun(0) & Sat(6)
  });

  // ── Split shifts (same user, two non-overlapping windows) all week ─────────
  it('CONTROL: split shifts (two non-overlapping windows) create 14 rows across the week', async () => {
    const res = await bulk({
      shop_id: shopId,
      week_start: monStr,
      days: ALL_DAYS,
      assignments: [
        { user_id: staffId, start_time: '06:00', end_time: '10:00' },
        { user_id: staffId, start_time: '18:00', end_time: '22:00' },
      ],
    });
    expectEnvelope(res, 201);
    expect(res.body.data.created).toBe(14);
    expect(res.body.data.skipped).toBe(0);
  });

  it('EDGE: two OVERLAPPING windows for the same user drop one window every day', async () => {
    const res = await bulk({
      shop_id: shopId,
      week_start: monStr,
      days: ALL_DAYS,
      assignments: [
        { user_id: staffId, start_time: '09:00', end_time: '17:00' },
        { user_id: staffId, start_time: '16:00', end_time: '20:00' }, // overlaps 16–17
      ],
    });
    expectEnvelope(res, 201);
    // First window accepted each day; second overlaps and is skipped each day.
    expect(res.body.data.created).toBe(7);
    expect(res.body.data.skipped).toBe(7);
  });

  // ── Validation paths ───────────────────────────────────────────────────────
  it('VALIDATION: day value out of range (7) returns 400', async () => {
    const res = await bulk({
      shop_id: shopId,
      week_start: monStr,
      days: [0, 7],
      assignments: [{ user_id: staffId, start_time: '09:00', end_time: '17:00' }],
    });
    expect(res.status).toBe(400);
  });

  it('VALIDATION: empty assignments returns 400', async () => {
    const res = await bulk({
      shop_id: shopId,
      week_start: monStr,
      days: ALL_DAYS,
      assignments: [],
    });
    expect(res.status).toBe(400);
  });

  it('VALIDATION: missing end_time for an assignment returns 400', async () => {
    const res = await bulk({
      shop_id: shopId,
      week_start: monStr,
      days: ALL_DAYS,
      assignments: [{ user_id: staffId, start_time: '09:00' }],
    });
    expect(res.status).toBe(400);
  });
});
