const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Rota = require('../models/Rota');
const User = require('../models/User');
const Shop = require('../models/Shop');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { parsePagination, toPageMeta } = require('../utils/pagination');
const {
  reconcileOverdueAutoPunchOuts,
  reconcileUserOverdueAutoPunchOuts,
} = require('../utils/attendanceReconcile');
const {
  isShopAllowed,
  buildReadScope,
  buildShopScope,
} = require('../middleware/shopScopeMiddleware');

const PRE_SHIFT_GRACE_HOURS = 1;
const AUTO_PUNCH_OUT_AFTER_SHIFT_HOURS = 2;

function addHours(dateValue, hours) {
  const date = new Date(dateValue);
  date.setTime(date.getTime() + hours * 60 * 60 * 1000);
  return date;
}

function toUtcStartOfDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function toUtcEndOfDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function minutesBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

function toHours(minutes) {
  return Number((minutes / 60).toFixed(2));
}

function subtractDays(dateValue, days) {
  const d = new Date(dateValue);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function toObjectIdIfValid(value) {
  if (!value || typeof value !== 'string') return value;
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function normalizeId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
}

function parseHHMMToMinutes(value) {
  const [h, m] = String(value).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function combineDateWithMinuteOffset(day, minuteOffset) {
  const date = new Date(day);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCMinutes(minuteOffset, 0, 0);
  return date;
}

function eachUtcDay(startDate, endDate) {
  const days = [];
  const cursor = new Date(startDate);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);

  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

function buildEffectiveWindow(punchIn, punchOut, adjustedMinutes) {
  const start = new Date(punchIn);
  const actualMinutes = minutesBetween(punchIn, punchOut);
  const safeAdjusted = Math.max(0, Math.min(actualMinutes, Number(adjustedMinutes) || 0));
  const end = new Date(start.getTime() + safeAdjusted * 60000);
  const source = safeAdjusted === actualMinutes ? 'Actual' : 'Adjusted';

  return {
    effective_start: start,
    effective_end: end,
    effective_minutes: safeAdjusted,
    effective_source: source,
  };
}

function findCoverageGapsForIntervals({ intervals, openStart, openEnd }) {
  const clipped = intervals
    .map((entry) => ({
      start: new Date(Math.max(new Date(entry.start).getTime(), openStart.getTime())),
      end: new Date(Math.min(new Date(entry.end).getTime(), openEnd.getTime())),
    }))
    .filter((entry) => entry.end > entry.start);

  if (clipped.length === 0) {
    return [{ start: openStart, end: openEnd }];
  }

  const eventsByTime = new Map();
  const addDelta = (time, delta) => {
    const key = time.toISOString();
    eventsByTime.set(key, (eventsByTime.get(key) || 0) + delta);
  };

  clipped.forEach((entry) => {
    addDelta(entry.start, 1);
    addDelta(entry.end, -1);
  });

  const sortedTimes = [...eventsByTime.keys()].sort();
  const gaps = [];
  let active = 0;
  let cursor = new Date(openStart);

  sortedTimes.forEach((iso) => {
    const point = new Date(iso);
    if (point > cursor && active <= 0) {
      gaps.push({ start: new Date(cursor), end: new Date(point) });
    }

    active += eventsByTime.get(iso);
    if (point > cursor) cursor = point;
  });

  if (cursor < openEnd && active <= 0) {
    gaps.push({ start: new Date(cursor), end: new Date(openEnd) });
  }

  return gaps;
}

function formatGap(gap) {
  return {
    start: gap.start.toISOString(),
    end: gap.end.toISOString(),
    minutes: Math.max(0, Math.round((gap.end.getTime() - gap.start.getTime()) / 60000)),
  };
}

function formatGapLabel(gap) {
  const start = new Date(gap.start).toISOString().slice(0, 16).replace('T', ' ');
  const end = new Date(gap.end).toISOString().slice(0, 16).replace('T', ' ');
  return `${start} to ${end} UTC (${gap.minutes}m uncovered)`;
}

function minutesFromRange(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

function resolveShopHoursForInstant(shop, instant) {
  const history = Array.isArray(shop.shop_time_history) ? shop.shop_time_history : [];
  const at = new Date(instant);

  const matched = history
    .filter((entry) => {
      const from = entry.effective_from ? new Date(entry.effective_from) : null;
      const to = entry.effective_to ? new Date(entry.effective_to) : null;
      if (!from) return false;
      if (at < from) return false;
      if (to && at >= to) return false;
      return true;
    })
    .sort((a, b) => new Date(b.effective_from) - new Date(a.effective_from))[0];

  if (matched) {
    return {
      opening_time: matched.opening_time,
      closing_time: matched.closing_time,
      source: 'history',
    };
  }

  return {
    opening_time: shop.opening_time,
    closing_time: shop.closing_time,
    source: 'current',
  };
}

function buildShopCoverageWindows(shop, rangeStart, rangeEnd) {
  const windows = [];
  let requiredCoverageMinutes = 0;

  eachUtcDay(rangeStart, rangeEnd).forEach((day) => {
    const dayHours = resolveShopHoursForInstant(shop, day);
    const openMinute = parseHHMMToMinutes(dayHours.opening_time);
    const closeMinute = parseHHMMToMinutes(dayHours.closing_time);
    if (openMinute === null || closeMinute === null || closeMinute <= openMinute) {
      throw new AppError('Shop opening_time/closing_time are invalid for coverage checks', 400);
    }

    const windowStart = combineDateWithMinuteOffset(day, openMinute);
    const windowEnd = combineDateWithMinuteOffset(day, closeMinute);

    if (windowEnd <= rangeStart || windowStart >= rangeEnd) return;

    const start = new Date(Math.max(windowStart.getTime(), rangeStart.getTime()));
    const end = new Date(Math.min(windowEnd.getTime(), rangeEnd.getTime()));
    if (end <= start) return;

    windows.push({ start, end });
    requiredCoverageMinutes += Math.round((end.getTime() - start.getTime()) / 60000);
  });

  return { windows, requiredCoverageMinutes };
}

function pickUserWithMostRemaining(userIds, remainingMinutesByUser) {
  let selected = null;
  let maxRemaining = 0;

  userIds.forEach((userId) => {
    const remaining = Math.max(0, Number(remainingMinutesByUser.get(userId)) || 0);
    if (remaining > maxRemaining) {
      maxRemaining = remaining;
      selected = userId;
    }
  });

  return selected;
}

function mergeIntervals(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => new Date(a.start) - new Date(b.start));
  const merged = [{ start: new Date(sorted[0].start), end: new Date(sorted[0].end) }];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    const currentStart = new Date(current.start);
    const currentEnd = new Date(current.end);

    if (currentStart.getTime() === last.end.getTime()) {
      last.end = currentEnd;
      continue;
    }

    merged.push({ start: currentStart, end: currentEnd });
  }

  return merged;
}

function buildBulkRegeneratedIntervals({ windows, userIds, targetMinutesByUser }) {
  const allocationsByUser = new Map(userIds.map((userId) => [userId, []]));
  const remainingMinutesByUser = new Map(
    userIds.map((userId) => [userId, Math.max(0, Number(targetMinutesByUser.get(userId)) || 0)])
  );

  const gaps = [];
  windows.forEach((window) => {
    let cursor = new Date(window.start);
    const windowEnd = new Date(window.end);

    while (cursor < windowEnd) {
      const selectedUser = pickUserWithMostRemaining(userIds, remainingMinutesByUser);
      if (!selectedUser) {
        gaps.push({ start: new Date(cursor), end: windowEnd });
        break;
      }

      const available = Math.max(0, Number(remainingMinutesByUser.get(selectedUser)) || 0);
      const needed = minutesFromRange(cursor, windowEnd);
      const allocated = Math.min(available, needed);
      if (allocated <= 0) {
        gaps.push({ start: new Date(cursor), end: windowEnd });
        break;
      }

      const segmentEnd = new Date(cursor.getTime() + allocated * 60000);
      allocationsByUser.get(selectedUser).push({ start: new Date(cursor), end: segmentEnd });
      remainingMinutesByUser.set(selectedUser, available - allocated);
      cursor = segmentEnd;
    }
  });

  userIds.forEach((userId) => {
    let remaining = Math.max(0, Number(remainingMinutesByUser.get(userId)) || 0);
    if (remaining <= 0) return;

    while (remaining > 0) {
      const beforePass = remaining;
      for (const window of windows) {
        if (remaining <= 0) break;
        const windowMinutes = minutesFromRange(window.start, window.end);
        if (windowMinutes <= 0) continue;

        const allocated = Math.min(windowMinutes, remaining);
        const segmentStart = new Date(window.start);
        const segmentEnd = new Date(segmentStart.getTime() + allocated * 60000);
        allocationsByUser.get(userId).push({ start: segmentStart, end: segmentEnd });
        remaining -= allocated;
      }

      if (remaining === beforePass) break;
    }

    remainingMinutesByUser.set(userId, remaining);
  });

  return { allocationsByUser, remainingMinutesByUser, gaps };
}

async function assertShopHasContinuousCoverage({
  shopId,
  rangeStart,
  rangeEnd,
  effectiveOverridesByAttendanceId = new Map(),
}) {
  const shop = await Shop.findById(shopId).select(
    'opening_time closing_time name shop_time_history'
  );
  if (!shop) throw new AppError('Shop not found', 404);

  const records = await Attendance.find({
    shop_id: shopId,
    is_active: { $ne: false },
    punch_in: { $lte: rangeEnd },
    punch_out: { $ne: null, $gte: rangeStart },
  }).select('user_id punch_in punch_out effective_start effective_end');

  const { windows, requiredCoverageMinutes } = buildShopCoverageWindows(shop, rangeStart, rangeEnd);
  const gaps = [];
  windows.forEach(({ start: checkStart, end: checkEnd }) => {
    const intervals = records.map((record) => {
      const key = String(record._id);
      const override = effectiveOverridesByAttendanceId.get(key);
      const effectiveStart = override?.effective_start || record.effective_start || record.punch_in;
      const effectiveEnd = override?.effective_end || record.effective_end || record.punch_out;
      return {
        start: effectiveStart,
        end: effectiveEnd,
      };
    });

    const dayGaps = findCoverageGapsForIntervals({
      intervals,
      openStart: checkStart,
      openEnd: checkEnd,
    });

    dayGaps.forEach((gap) => gaps.push(formatGap(gap)));
  });

  if (gaps.length > 0) {
    // Simple estimate based on total allocated minutes, not exact placement/overlap.
    const naiveAllocatedMinutes = records.reduce((sum, record) => {
      const key = String(record._id);
      const override = effectiveOverridesByAttendanceId.get(key);
      const effectiveStart = override?.effective_start || record.effective_start || record.punch_in;
      const effectiveEnd = override?.effective_end || record.effective_end || record.punch_out;
      return sum + minutesFromRange(effectiveStart, effectiveEnd);
    }, 0);

    const totalMissingMinutes = gaps.reduce((sum, gap) => sum + (gap.minutes || 0), 0);
    const previewGaps = gaps.slice(0, 10);
    const firstGap = previewGaps[0] || null;
    const coveredMinutesAfterAdjustment = Math.max(
      0,
      requiredCoverageMinutes - totalMissingMinutes
    );
    const naiveExpectedMissingMinutes = Math.max(
      0,
      requiredCoverageMinutes - naiveAllocatedMinutes
    );

    throw new AppError(
      'Coverage check failed: adjustment leaves shop open-time gaps without staff',
      409,
      {
        error_code: 'COVERAGE_GAP_AFTER_ADJUSTMENT',
        shop_id: normalizeId(shopId),
        shop_name: shop.name,
        range_start: rangeStart.toISOString(),
        range_end: rangeEnd.toISOString(),
        required_coverage_hours: toHours(requiredCoverageMinutes),
        achievable_coverage_hours_after_adjustment: toHours(coveredMinutesAfterAdjustment),
        expected_missing_if_even_distribution_hours: toHours(naiveExpectedMissingMinutes),
        total_missing_minutes: totalMissingMinutes,
        total_missing_hours: toHours(totalMissingMinutes),
        gaps_count: gaps.length,
        gaps: previewGaps,
        uncovered_windows_preview: previewGaps.slice(0, 3).map(formatGapLabel),
        summary: `There are ${gaps.length} uncovered window(s) totalling ${toHours(totalMissingMinutes)} hours in the selected date range.`,
        possible_solutions: [
          `Increase combined target hours by at least ${toHours(totalMissingMinutes)}h in this range.`,
          firstGap
            ? `Ensure at least one user covers ${formatGapLabel(firstGap)}.`
            : 'Ensure at least one user covers each uncovered window.',
          'Reduce the selected date range to days that already have attendance coverage.',
          'Add missing attendance/rota records for uncovered windows, then re-run adjustment.',
        ],
        notes: {
          required_coverage_hours:
            'Total shop open hours in selected date range that must be covered.',
          achievable_coverage_hours_after_adjustment:
            'Exact covered hours after applying current adjustment plan and overlap checks.',
          expected_missing_if_even_distribution_hours:
            'Naive estimate if allocated minutes were spread ideally; actual missing can be higher due to overlaps/day placement.',
          total_missing_hours: 'Exact uncovered open hours after applying current adjustment plan.',
          gaps: 'Exact uncovered time windows (UTC) that need staffing coverage.',
          possible_solutions: 'Suggested actions admin can take before retrying adjustment.',
        },
        admin_hint:
          'Increase target hours, include more users, or reduce date range until uncovered windows are removed.',
      }
    );
  }
}

function assertCanAdjustForShop(user, shopId) {
  const permissions = user?.role_id?.permissions || {};
  const canAdjust = Boolean(permissions.can_adjust_attendance_hours);

  if (!canAdjust) {
    throw new AppError('Forbidden: not allowed to adjust attendance hours', 403);
  }

  const scope = buildReadScope(user);
  if (scope.mode === 'shops' && !scope.shopScope.all && !isShopAllowed(scope.shopScope, shopId)) {
    throw new AppError('Forbidden: shop is outside your assigned scope', 403);
  }
}

function buildAdjustmentPlan(records, targetMinutes) {
  const withActual = records.map((record) => ({
    record,
    actualMinutes: minutesBetween(record.punch_in, record.punch_out),
  }));

  const actualMinutesTotal = withActual.reduce((sum, item) => sum + item.actualMinutes, 0);
  if (targetMinutes > actualMinutesTotal) {
    throw new AppError(
      `target_hours cannot exceed actual closed attendance hours (${toHours(actualMinutesTotal)}h)`,
      400
    );
  }

  let reduceRemaining = actualMinutesTotal - targetMinutes;
  const allocations = withActual.map((item) => ({
    attendanceId: item.record._id,
    actualMinutes: item.actualMinutes,
    adjustedMinutes: item.actualMinutes,
    punch_in: item.record.punch_in,
    punch_out: item.record.punch_out,
  }));

  // Reduce from latest closed punches first.
  for (let i = allocations.length - 1; i >= 0 && reduceRemaining > 0; i -= 1) {
    const reducible = allocations[i].adjustedMinutes;
    const cut = Math.min(reducible, reduceRemaining);
    allocations[i].adjustedMinutes -= cut;
    reduceRemaining -= cut;
  }

  const adjustedMinutesTotal = allocations.reduce((sum, item) => sum + item.adjustedMinutes, 0);

  allocations.forEach((item) => {
    const effective = buildEffectiveWindow(item.punch_in, item.punch_out, item.adjustedMinutes);
    item.effective_start = effective.effective_start;
    item.effective_end = effective.effective_end;
    item.effective_minutes = effective.effective_minutes;
    item.effective_source = effective.effective_source;
  });

  return {
    actualMinutesTotal,
    adjustedMinutesTotal,
    reducedMinutesTotal: actualMinutesTotal - adjustedMinutesTotal,
    allocations,
  };
}

async function buildClosedAttendanceAdjustment({ userId, shopId, fromDate, toDate, targetHours }) {
  const rangeStart = toUtcStartOfDay(fromDate);
  const rangeEnd = toUtcEndOfDay(toDate);
  if (!rangeStart || !rangeEnd) {
    throw new AppError('from_date and to_date must be valid ISO dates', 400);
  }
  if (rangeEnd < rangeStart) {
    throw new AppError('to_date must be greater than or equal to from_date', 400);
  }

  const targetNum = Number(targetHours);
  if (!Number.isFinite(targetNum) || targetNum < 0) {
    throw new AppError('target_hours must be a non-negative number', 400);
  }

  const records = await Attendance.find({
    user_id: userId,
    shop_id: shopId,
    is_active: { $ne: false },
    punch_out: { $ne: null },
    punch_in: { $gte: rangeStart, $lte: rangeEnd },
  }).sort({ punch_in: 1 });

  if (records.length === 0) {
    throw new AppError('No closed punch-out attendance records found in selected date range', 404);
  }

  const targetMinutes = Math.round(targetNum * 60);
  const plan = buildAdjustmentPlan(records, targetMinutes);

  return {
    rangeStart,
    rangeEnd,
    targetHours: targetNum,
    targetMinutes,
    records,
    ...plan,
  };
}

async function findShopUsersWithClosedAttendanceInRange({ shopId, fromDate, toDate }) {
  const records = await Attendance.find({
    shop_id: shopId,
    is_active: { $ne: false },
    punch_out: { $ne: null },
    punch_in: { $gte: fromDate, $lte: toDate },
  }).select('user_id');

  const userIds = [...new Set(records.map((record) => String(record.user_id)))];
  if (userIds.length === 0) return [];

  const users = await User.find({ _id: { $in: userIds }, is_active: true })
    .select('name email')
    .sort({ name: 1 });

  return users.map((user) => ({
    user_id: user._id.toString(),
    name: user.name,
    email: user.email,
  }));
}

function isWithinPunchInWindow(now, rota) {
  const earliestAllowed = addHours(rota.shift_start, -PRE_SHIFT_GRACE_HOURS);
  const latestAllowed = addHours(rota.shift_end, AUTO_PUNCH_OUT_AFTER_SHIFT_HOURS);
  return now >= earliestAllowed && now <= latestAllowed;
}

function compareRotaPriority(a, b, now) {
  const aActive = a.shift_start <= now && a.shift_end >= now;
  const bActive = b.shift_start <= now && b.shift_end >= now;
  if (aActive && !bActive) return -1;
  if (!aActive && bActive) return 1;

  const aUpcoming = a.shift_start > now;
  const bUpcoming = b.shift_start > now;
  if (aUpcoming && bUpcoming) return a.shift_start - b.shift_start;
  if (aUpcoming && !bUpcoming) return -1;
  if (!aUpcoming && bUpcoming) return 1;

  return b.shift_start - a.shift_start;
}

async function findEligibleRotas({ userId, shopId, now }) {
  return Rota.find({
    user_id: userId,
    shop_id: shopId,
    shift_start: { $lte: addHours(now, PRE_SHIFT_GRACE_HOURS) },
    shift_end: { $gte: addHours(now, -AUTO_PUNCH_OUT_AFTER_SHIFT_HOURS) },
  }).sort({ shift_start: 1 });
}

async function resolveRotaForPunch({ userId, shopId, rotaId, now }) {
  if (rotaId) {
    const selected = await Rota.findOne({
      _id: rotaId,
      user_id: userId,
      shop_id: shopId,
    });

    if (!selected) {
      throw new AppError('Selected rota was not found for this user and shop', 404);
    }

    if (!isWithinPunchInWindow(now, selected)) {
      throw new AppError('Selected rota is outside the allowed punch-in window', 400);
    }

    return selected;
  }

  const candidates = await findEligibleRotas({ userId, shopId, now });
  if (candidates.length === 0) {
    throw new AppError(
      'No eligible rota found. Select a rota within 1 hour before shift start or up to 2 hours after shift end.',
      400
    );
  }

  candidates.sort((a, b) => compareRotaPriority(a, b, now));
  return candidates[0];
}

async function runAutoPunchOutSweep() {
  await reconcileOverdueAutoPunchOuts({ limit: 200 });
}

// ─────────────────────────────────────────────
// STEP 1: Verify GPS location → return a short-lived location_token
// POST /api/attendance/verify-location
// geoMiddleware runs BEFORE this — if we reach here, GPS passed
// ─────────────────────────────────────────────
const verifyLocation = asyncHandler(async (req, res) => {
  const { shop_id } = req.body;

  const locationToken = jwt.sign(
    { userId: req.user._id, shopId: shop_id },
    process.env.LOCATION_TOKEN_SECRET,
    { expiresIn: `${process.env.LOCATION_TOKEN_TTL_MINUTES}m` }
  );

  return sendSuccess(res, 'Location verified. Proceed with biometric confirmation.', {
    location_token: locationToken,
  });
});

// ─────────────────────────────────────────────
// STEP 2+3: Biometric result + location_token → Punch-In
// POST /api/attendance/punch-in
// ─────────────────────────────────────────────
const punchIn = asyncHandler(async (req, res) => {
  const { shop_id, location_token, biometric_verified, rota_id = null } = req.body;
  const deviceId = req.headers['x-device-id'];
  await runAutoPunchOutSweep();

  // 1. Biometric must be confirmed by frontend
  if (!biometric_verified) {
    throw new AppError('Biometric confirmation failed', 403);
  }

  // 2. Verify location_token
  let decoded;
  try {
    decoded = jwt.verify(location_token, process.env.LOCATION_TOKEN_SECRET);
  } catch {
    throw new AppError(
      'Location token is invalid or expired. Please re-verify your location.',
      403
    );
  }

  // 3. Token must match the requesting user and shop
  if (decoded.userId.toString() !== req.user._id.toString() || decoded.shopId !== shop_id) {
    throw new AppError('Location token mismatch', 403);
  }

  // 4. Device ID check
  if (!req.user.device_id) {
    throw new AppError('No device registered. Please register device after login.', 403);
  }
  if (!deviceId || deviceId !== req.user.device_id) {
    throw new AppError('Device not recognised. Registered device ID mismatch.', 403);
  }

  // 5. Check no open punch-in already exists
  const existing = await Attendance.findOne({
    user_id: req.user._id,
    punch_out: null,
    is_active: { $ne: false },
  });
  if (existing) {
    throw new AppError('Already punched in. Please punch out first.', 400);
  }

  const now = new Date();
  const matchedRota = await resolveRotaForPunch({
    userId: req.user._id,
    shopId: shop_id,
    rotaId: rota_id,
    now,
  });

  const attendance = await Attendance.create({
    user_id: req.user._id,
    shop_id,
    rota_id: matchedRota._id,
    punch_in: now,
    auto_punch_out_at: addHours(matchedRota.shift_end, AUTO_PUNCH_OUT_AFTER_SHIFT_HOURS),
    is_manual: false,
    punch_method: 'GPS+Biometric',
  });

  const populated = await attendance.populate([
    {
      path: 'rota_id',
      select: 'shift_start shift_end shift_date start_time end_time note shop_id user_id',
    },
  ]);

  return sendSuccess(res, 'Punch-in successful', { attendance: populated }, 201);
});

// ─────────────────────────────────────────────
// Punch-Out
// PUT /api/attendance/:id/punch-out
// ─────────────────────────────────────────────
const punchOut = asyncHandler(async (req, res) => {
  await runAutoPunchOutSweep();
  const attendance = await Attendance.findById(req.params.id);

  if (!attendance) {
    throw new AppError('Attendance record not found', 404);
  }
  if (attendance.user_id.toString() !== req.user._id.toString()) {
    throw new AppError('Not authorised to punch out this record', 403);
  }
  if (attendance.punch_out) {
    throw new AppError('Already punched out', 400);
  }

  attendance.punch_out = new Date();
  attendance.punch_out_source = 'Manual';
  await attendance.save();

  return sendSuccess(res, 'Punch-out successful', { attendance });
});

// ─────────────────────────────────────────────
// Manual Punch-In — Sub-Manager exception flow
// POST /api/attendance/manual-punch-in
// Requires: can_manual_punch permission (checked in route via permMiddleware)
// ─────────────────────────────────────────────
const manualPunchIn = asyncHandler(async (req, res) => {
  const { user_id, shop_id, rota_id = null } = req.body;
  await runAutoPunchOutSweep();

  if (!user_id || !shop_id) {
    throw new AppError('user_id and shop_id are required', 400);
  }

  const staffUser = await User.findById(user_id);
  if (!staffUser || !staffUser.is_active) {
    throw new AppError('Staff member not found', 404);
  }

  // Check no open punch-in already exists
  const existing = await Attendance.findOne({
    user_id,
    punch_out: null,
    is_active: { $ne: false },
  });
  if (existing) {
    throw new AppError('Staff member is already punched in', 400);
  }

  const now = new Date();
  const matchedRota = await resolveRotaForPunch({
    userId: user_id,
    shopId: shop_id,
    rotaId: rota_id,
    now,
  });

  const attendance = await Attendance.create({
    user_id,
    shop_id,
    rota_id: matchedRota._id,
    punch_in: now,
    auto_punch_out_at: addHours(matchedRota.shift_end, AUTO_PUNCH_OUT_AFTER_SHIFT_HOURS),
    is_manual: true,
    manual_by: req.user._id,
    punch_method: 'Manual',
  });

  const populated = await attendance.populate([
    { path: 'user_id', select: 'name email' },
    { path: 'manual_by', select: 'name email' },
    {
      path: 'rota_id',
      select: 'shift_start shift_end shift_date start_time end_time note shop_id user_id',
    },
  ]);

  return sendSuccess(res, 'Manual punch-in successful', { attendance: populated }, 201);
});

// ─────────────────────────────────────────────
// GET all attendance records (admin/manager view)
// GET /api/attendance
// ─────────────────────────────────────────────
const getAttendance = asyncHandler(async (req, res) => {
  await runAutoPunchOutSweep();
  const roleName = String(req.user?.role_id?.role_name || '')
    .trim()
    .toLowerCase();
  const isRootViewer = roleName === 'root';
  const isAdminViewer = roleName === 'admin';

  const scope = buildReadScope(req.user);
  const isGlobalViewer = scope.mode === 'all' || isAdminViewer;
  const filter = { is_active: { $ne: false } };
  const requestedShopId = req.query.shop_id ? String(req.query.shop_id) : null;
  const { page, limit, skip, sort } = parsePagination(req.query, {
    defaultSortBy: 'punch_in',
    allowedSortBy: ['punch_in', 'punch_out', 'createdAt', 'updatedAt'],
  });
  let enforcedShopIds = null;

  if (!isRootViewer && isGlobalViewer) {
    const shopScope = buildShopScope(req.user);
    enforcedShopIds = Array.isArray(shopScope.ids) ? shopScope.ids.map((id) => String(id)) : [];

    // Admin/global viewers can read all shops by default.
    // Keep `enforcedShopIds` only for non-admin global roles.
    if (!isAdminViewer && !requestedShopId && enforcedShopIds.length > 0) {
      filter.shop_id = { $in: enforcedShopIds };
    }
  } else if (scope.mode === 'self') {
    filter.user_id = req.user._id;
  } else if (scope.mode === 'shops') {
    if (!scope.shopScope.all && scope.shopScope.ids.length === 0) {
      return sendSuccess(res, 'Attendance records fetched successfully', {
        ...toPageMeta(0, page, limit, 0),
        records: [],
      });
    }
    if (!scope.shopScope.all) {
      filter.shop_id = { $in: scope.shopScope.ids };
    }
  }

  if (req.query.user_id && scope.mode !== 'self') filter.user_id = req.query.user_id;
  const thirtyDayFloor = subtractDays(new Date(), 30);
  if (req.query.from_date || req.query.to_date) {
    const dateFilter = {};
    if (req.query.from_date) {
      const fromDate = toUtcStartOfDay(req.query.from_date);
      if (!fromDate) throw new AppError('from_date must be a valid ISO date', 400);
      dateFilter.$gte = fromDate;
    }
    if (req.query.to_date) {
      const toDate = toUtcEndOfDay(req.query.to_date);
      if (!toDate) throw new AppError('to_date must be a valid ISO date', 400);
      dateFilter.$lte = toDate;
    }

    if (!isGlobalViewer) {
      if (!dateFilter.$gte || dateFilter.$gte < thirtyDayFloor) {
        dateFilter.$gte = thirtyDayFloor;
      }
    }

    filter.punch_in = dateFilter;
  } else if (!isGlobalViewer) {
    filter.punch_in = { $gte: thirtyDayFloor };
  }
  if (requestedShopId) {
    if (
      !isAdminViewer &&
      enforcedShopIds &&
      enforcedShopIds.length > 0 &&
      !enforcedShopIds.includes(requestedShopId)
    ) {
      return sendSuccess(res, 'Attendance records fetched successfully', {
        ...toPageMeta(0, page, limit, 0),
        records: [],
      });
    }
    if (
      scope.mode === 'shops' &&
      !scope.shopScope.all &&
      !isShopAllowed(scope.shopScope, requestedShopId)
    ) {
      return sendSuccess(res, 'Attendance records fetched successfully', {
        ...toPageMeta(0, page, limit, 0),
        records: [],
      });
    }
    filter.shop_id = requestedShopId;
  }

  const [total, records] = await Promise.all([
    Attendance.countDocuments(filter),
    Attendance.find(filter)
      .populate('user_id', 'name email')
      .populate('shop_id', 'name')
      .populate('rota_id', 'shift_start shift_end shift_date start_time end_time note')
      .populate('manual_by', 'name email')
      .sort(sort)
      .skip(skip)
      .limit(limit),
  ]);

  const actualMinutes = records.reduce(
    (sum, record) => sum + minutesBetween(record.punch_in, record.punch_out),
    0
  );
  const adjustedMinutes = records.reduce((sum, record) => {
    if (record.effective_minutes !== null && record.effective_minutes !== undefined) {
      return sum + Math.max(0, Number(record.effective_minutes));
    }
    if (record.adjusted_minutes === null || record.adjusted_minutes === undefined) {
      return sum + minutesBetween(record.punch_in, record.punch_out);
    }
    return sum + Math.max(0, Number(record.adjusted_minutes));
  }, 0);

  const visibleRecords = records.map((record) => {
    if (isRootViewer) return record;

    const dto = record.toObject();
    if (record.effective_start && record.effective_end) {
      dto.punch_in = record.effective_start;
      dto.punch_out = record.effective_end;
    }
    return dto;
  });

  return sendSuccess(res, 'Attendance records fetched successfully', {
    ...toPageMeta(total, page, limit, visibleRecords.length),
    from_date: req.query.from_date || null,
    to_date: req.query.to_date || null,
    actual_hours_total: toHours(actualMinutes),
    adjusted_hours_total: toHours(adjustedMinutes),
    records: visibleRecords,
  });
});

// GET grouped attendance summary by user
// GET /api/attendance/summary-by-user
const getAttendanceSummaryByUser = asyncHandler(async (req, res) => {
  await runAutoPunchOutSweep();
  const roleName = String(req.user?.role_id?.role_name || '')
    .trim()
    .toLowerCase();
  const isRootViewer = roleName === 'root';
  const isAdminViewer = roleName === 'admin';

  const scope = buildReadScope(req.user);
  const isGlobalViewer = scope.mode === 'all' || isAdminViewer;
  const filter = { is_active: { $ne: false } };
  const requestedShopId = req.query.shop_id ? String(req.query.shop_id) : null;
  const { page, limit, skip } = parsePagination(req.query, {
    defaultSortBy: 'createdAt',
    allowedSortBy: ['createdAt'],
  });
  const sortBy = String(req.query.sort_by || 'total_work_hours').trim();
  const sortDir = String(req.query.sort_dir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  let enforcedShopIds = null;

  if (!isRootViewer && isGlobalViewer) {
    const shopScope = buildShopScope(req.user);
    enforcedShopIds = Array.isArray(shopScope.ids) ? shopScope.ids.map((id) => String(id)) : [];

    if (!isAdminViewer && !requestedShopId && enforcedShopIds.length > 0) {
      filter.shop_id = { $in: enforcedShopIds };
    }
  } else if (scope.mode === 'self') {
    filter.user_id = req.user._id;
  } else if (scope.mode === 'shops') {
    if (!scope.shopScope.all && scope.shopScope.ids.length === 0) {
      return sendSuccess(res, 'Attendance summary by user fetched successfully', {
        ...toPageMeta(0, page, limit, 0),
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null,
        users: [],
      });
    }
    if (!scope.shopScope.all) {
      filter.shop_id = { $in: scope.shopScope.ids };
    }
  }

  if (req.query.user_id && scope.mode !== 'self') filter.user_id = req.query.user_id;
  const thirtyDayFloor = subtractDays(new Date(), 30);
  if (req.query.from_date || req.query.to_date) {
    const dateFilter = {};
    if (req.query.from_date) {
      const fromDate = toUtcStartOfDay(req.query.from_date);
      if (!fromDate) throw new AppError('from_date must be a valid ISO date', 400);
      dateFilter.$gte = fromDate;
    }
    if (req.query.to_date) {
      const toDate = toUtcEndOfDay(req.query.to_date);
      if (!toDate) throw new AppError('to_date must be a valid ISO date', 400);
      dateFilter.$lte = toDate;
    }

    if (!isGlobalViewer) {
      if (!dateFilter.$gte || dateFilter.$gte < thirtyDayFloor) {
        dateFilter.$gte = thirtyDayFloor;
      }
    }

    filter.punch_in = dateFilter;
  } else if (!isGlobalViewer) {
    filter.punch_in = { $gte: thirtyDayFloor };
  }

  if (requestedShopId) {
    if (
      !isAdminViewer &&
      enforcedShopIds &&
      enforcedShopIds.length > 0 &&
      !enforcedShopIds.includes(requestedShopId)
    ) {
      return sendSuccess(res, 'Attendance summary by user fetched successfully', {
        ...toPageMeta(0, page, limit, 0),
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null,
        users: [],
      });
    }
    if (
      scope.mode === 'shops' &&
      !scope.shopScope.all &&
      !isShopAllowed(scope.shopScope, requestedShopId)
    ) {
      return sendSuccess(res, 'Attendance summary by user fetched successfully', {
        ...toPageMeta(0, page, limit, 0),
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null,
        users: [],
      });
    }
    filter.shop_id = requestedShopId;
  }

  const match = { ...filter };
  if (typeof match.user_id === 'string') match.user_id = toObjectIdIfValid(match.user_id);
  if (typeof match.shop_id === 'string') match.shop_id = toObjectIdIfValid(match.shop_id);
  if (match.shop_id?.$in) {
    match.shop_id = { $in: match.shop_id.$in.map((id) => toObjectIdIfValid(String(id))) };
  }

  const actualMinutesExpr = {
    $cond: [
      { $and: [{ $ne: ['$punch_in', null] }, { $ne: ['$punch_out', null] }] },
      { $divide: [{ $subtract: ['$punch_out', '$punch_in'] }, 60000] },
      0,
    ],
  };

  const workMinutesExpr = isRootViewer
    ? actualMinutesExpr
    : {
        $ifNull: ['$effective_minutes', { $ifNull: ['$adjusted_minutes', actualMinutesExpr] }],
      };

  const sortStage =
    sortBy === 'name'
      ? { name: sortDir, total_work_minutes: -1 }
      : { total_work_minutes: sortDir, name: 1 };

  const [result] = await Attendance.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$user_id',
        records_count: { $sum: 1 },
        total_actual_minutes: { $sum: { $max: [0, actualMinutesExpr] } },
        total_work_minutes: { $sum: { $max: [0, workMinutesExpr] } },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        user_id: '$_id',
        name: { $ifNull: ['$user.name', null] },
        email: { $ifNull: ['$user.email', null] },
        records_count: 1,
        total_actual_minutes: 1,
        total_work_minutes: 1,
      },
    },
    { $sort: sortStage },
    {
      $facet: {
        meta: [{ $count: 'total' }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    },
  ]);

  const total = result?.meta?.[0]?.total || 0;
  const users = (result?.data || []).map((item) => ({
    user_id: String(item.user_id),
    name: item.name,
    email: item.email,
    records_count: item.records_count,
    total_work_hours: toHours(item.total_work_minutes),
    total_actual_hours: toHours(item.total_actual_minutes),
  }));

  return sendSuccess(res, 'Attendance summary by user fetched successfully', {
    ...toPageMeta(total, page, limit, users.length),
    from_date: req.query.from_date || null,
    to_date: req.query.to_date || null,
    shop_id: requestedShopId,
    sort_by: sortBy,
    sort_dir: sortDir === 1 ? 'asc' : 'desc',
    users,
  });
});

const getEligibleRotas = asyncHandler(async (req, res) => {
  await runAutoPunchOutSweep();
  const { shop_id } = req.query;
  if (!shop_id) {
    throw new AppError('shop_id is required', 400);
  }

  const now = new Date();
  const rotas = await findEligibleRotas({ userId: req.user._id, shopId: shop_id, now });

  return sendSuccess(res, 'Eligible rotas fetched successfully', {
    count: rotas.length,
    rotas,
  });
});

const reconcileAllOverdue = asyncHandler(async (req, res) => {
  const result = await reconcileOverdueAutoPunchOuts({ limit: 500 });
  return sendSuccess(res, 'Overdue attendance auto punch-out reconciliation completed', result);
});

const reconcileSelfOverdue = asyncHandler(async (req, res) => {
  const result = await reconcileUserOverdueAutoPunchOuts(req.user._id, { limit: 200 });
  return sendSuccess(res, 'Self attendance reconciliation completed', result);
});

const previewClosedAttendanceAdjustment = asyncHandler(async (req, res) => {
  const { user_id, shop_id, from_date, to_date, target_hours } = req.body;
  if (!user_id || !shop_id || !from_date || !to_date || target_hours === undefined) {
    throw new AppError('user_id, shop_id, from_date, to_date, and target_hours are required', 400);
  }

  assertCanAdjustForShop(req.user, shop_id);

  const plan = await buildClosedAttendanceAdjustment({
    userId: user_id,
    shopId: shop_id,
    fromDate: from_date,
    toDate: to_date,
    targetHours: target_hours,
  });

  const previewOverrides = new Map(
    plan.allocations.map((item) => [
      String(item.attendanceId),
      {
        effective_start: item.effective_start,
        effective_end: item.effective_end,
      },
    ])
  );
  await assertShopHasContinuousCoverage({
    shopId: shop_id,
    rangeStart: plan.rangeStart,
    rangeEnd: plan.rangeEnd,
    effectiveOverridesByAttendanceId: previewOverrides,
  });

  return sendSuccess(res, 'Attendance hours adjustment preview generated successfully', {
    user_id,
    shop_id,
    from_date: plan.rangeStart.toISOString(),
    to_date: plan.rangeEnd.toISOString(),
    records_count: plan.records.length,
    actual_hours: toHours(plan.actualMinutesTotal),
    target_hours: plan.targetHours,
    adjusted_hours: toHours(plan.adjustedMinutesTotal),
    reduced_hours: toHours(plan.reducedMinutesTotal),
    coverage_safe: true,
    records: plan.allocations.map((item) => ({
      attendance_id: item.attendanceId,
      punch_in: item.punch_in,
      punch_out: item.punch_out,
      actual_hours: toHours(item.actualMinutes),
      adjusted_hours: toHours(item.adjustedMinutes),
    })),
  });
});

const applyClosedAttendanceAdjustment = asyncHandler(async (req, res) => {
  const { user_id, shop_id, from_date, to_date, target_hours, note = null } = req.body;
  if (!user_id || !shop_id || !from_date || !to_date || target_hours === undefined) {
    throw new AppError('user_id, shop_id, from_date, to_date, and target_hours are required', 400);
  }

  assertCanAdjustForShop(req.user, shop_id);

  const plan = await buildClosedAttendanceAdjustment({
    userId: user_id,
    shopId: shop_id,
    fromDate: from_date,
    toDate: to_date,
    targetHours: target_hours,
  });

  const applyOverrides = new Map(
    plan.allocations.map((item) => [
      String(item.attendanceId),
      {
        effective_start: item.effective_start,
        effective_end: item.effective_end,
      },
    ])
  );
  await assertShopHasContinuousCoverage({
    shopId: shop_id,
    rangeStart: plan.rangeStart,
    rangeEnd: plan.rangeEnd,
    effectiveOverridesByAttendanceId: applyOverrides,
  });

  const applyWriteResult = await Attendance.bulkWrite(
    plan.allocations.map((item) => ({
      updateOne: {
        filter: { _id: item.attendanceId },
        upsert: false,
        update: {
          $set: {
            adjusted_minutes: item.adjustedMinutes,
            adjusted_at: new Date(),
            adjusted_by: req.user._id,
            adjustment_note: note || null,
            effective_start: item.effective_start,
            effective_end: item.effective_end,
            effective_minutes: item.effective_minutes,
            effective_source: item.effective_source,
          },
        },
      },
    })),
    { ordered: false }
  );

  const expectedUpdates = plan.allocations.length;
  const matchedUpdates =
    applyWriteResult?.matchedCount ??
    applyWriteResult?.result?.nMatched ??
    applyWriteResult?.nMatched ??
    0;
  if (matchedUpdates < expectedUpdates) {
    throw new AppError(
      'Adjustment aborted: some attendance records no longer exist for update',
      409,
      {
        error_code: 'ATTENDANCE_ADJUST_UPDATE_MISMATCH',
        expected_updates: expectedUpdates,
        matched_updates: matchedUpdates,
        missing_updates: expectedUpdates - matchedUpdates,
      }
    );
  }

  return sendSuccess(res, 'Attendance hours adjustment applied successfully', {
    user_id,
    shop_id,
    from_date: plan.rangeStart.toISOString(),
    to_date: plan.rangeEnd.toISOString(),
    records_count: plan.records.length,
    actual_hours: toHours(plan.actualMinutesTotal),
    target_hours: plan.targetHours,
    adjusted_hours: toHours(plan.adjustedMinutesTotal),
    reduced_hours: toHours(plan.reducedMinutesTotal),
    coverage_safe: true,
  });
});

const getUnchangedUsersForRange = asyncHandler(async (req, res) => {
  const { shop_id, from_date, to_date } = req.query;
  if (!shop_id || !from_date || !to_date) {
    throw new AppError('shop_id, from_date, and to_date are required', 400);
  }

  assertCanAdjustForShop(req.user, shop_id);

  const rangeStart = toUtcStartOfDay(from_date);
  const rangeEnd = toUtcEndOfDay(to_date);
  if (!rangeStart || !rangeEnd) {
    throw new AppError('from_date and to_date must be valid ISO dates', 400);
  }

  const users = await findShopUsersWithClosedAttendanceInRange({
    shopId: shop_id,
    fromDate: rangeStart,
    toDate: rangeEnd,
  });
  const { page, limit } = parsePagination(req.query, {
    defaultSortBy: 'createdAt',
    allowedSortBy: ['createdAt'],
  });
  const start = (page - 1) * limit;
  const usersPage = users.slice(start, start + limit);

  return sendSuccess(res, 'Unchanged users fetched successfully', {
    shop_id,
    from_date: rangeStart.toISOString(),
    to_date: rangeEnd.toISOString(),
    ...toPageMeta(users.length, page, limit, usersPage.length),
    users: usersPage,
  });
});

const bulkAdjustClosedAttendanceByShop = asyncHandler(async (req, res) => {
  const { shop_id, from_date, to_date, adjustments, note = null } = req.body;
  if (
    !shop_id ||
    !from_date ||
    !to_date ||
    !Array.isArray(adjustments) ||
    adjustments.length === 0
  ) {
    throw new AppError('shop_id, from_date, to_date, and adjustments[] are required', 400);
  }

  assertCanAdjustForShop(req.user, shop_id);
  const rangeStart = toUtcStartOfDay(from_date);
  const rangeEnd = toUtcEndOfDay(to_date);
  if (!rangeStart || !rangeEnd) {
    throw new AppError('from_date and to_date must be valid ISO dates', 400);
  }
  if (rangeEnd < rangeStart) {
    throw new AppError('to_date must be greater than or equal to from_date', 400);
  }

  const shop = await Shop.findById(shop_id).select(
    'name opening_time closing_time shop_time_history'
  );
  if (!shop) {
    throw new AppError('Shop not found', 404);
  }

  const seenUsers = new Set();
  const targetMinutesByUser = new Map();
  for (const adjustment of adjustments) {
    if (!adjustment?.user_id || adjustment?.target_hours === undefined) {
      throw new AppError('Each adjustment item requires user_id and target_hours', 400);
    }
    const userId = String(adjustment.user_id);
    if (seenUsers.has(userId)) {
      throw new AppError(`Duplicate user_id in adjustments: ${userId}`, 400);
    }
    seenUsers.add(userId);

    const targetHoursNum = Number(adjustment.target_hours);
    if (!Number.isFinite(targetHoursNum) || targetHoursNum < 0) {
      throw new AppError(`target_hours must be a non-negative number for user ${userId}`, 400);
    }
    targetMinutesByUser.set(userId, Math.round(targetHoursNum * 60));
  }

  const selectedUserIds = [...targetMinutesByUser.keys()];
  const selectedUsers = await User.find({ _id: { $in: selectedUserIds }, is_active: true }).select(
    '_id shop_id name email'
  );
  if (selectedUsers.length !== selectedUserIds.length) {
    throw new AppError('Some selected users do not exist or are inactive', 404);
  }

  const invalidShopUser = selectedUsers.find(
    (user) => normalizeId(user.shop_id) !== normalizeId(shop_id)
  );
  if (invalidShopUser) {
    throw new AppError('All selected users must belong to the requested shop', 400, {
      user_id: normalizeId(invalidShopUser._id),
      user_email: invalidShopUser.email,
      expected_shop_id: normalizeId(shop_id),
      actual_shop_id: normalizeId(invalidShopUser.shop_id),
    });
  }

  const usersInRange = await findShopUsersWithClosedAttendanceInRange({
    shopId: shop_id,
    fromDate: rangeStart,
    toDate: rangeEnd,
  });

  const selectedUsersSet = new Set(selectedUserIds.map((id) => String(id)));
  const unchangedUsers = usersInRange.filter((user) => !selectedUsersSet.has(String(user.user_id)));
  if (unchangedUsers.length > 0) {
    throw new AppError(
      'Some users in this shop/date range are not selected. Include all users or adjust your date range.',
      409,
      {
        unchanged_users: unchangedUsers,
      }
    );
  }

  const { windows, requiredCoverageMinutes } = buildShopCoverageWindows(shop, rangeStart, rangeEnd);
  if (windows.length === 0) {
    throw new AppError('No shop open-time windows found inside the selected date range', 400);
  }

  const totalAdjustedMinutes = selectedUserIds.reduce(
    (sum, userId) => sum + Math.max(0, Number(targetMinutesByUser.get(userId)) || 0),
    0
  );

  if (totalAdjustedMinutes < requiredCoverageMinutes) {
    throw new AppError(
      'Coverage check failed: total target hours are below required shop open coverage',
      409,
      {
        error_code: 'INSUFFICIENT_TARGET_HOURS_FOR_COVERAGE',
        shop_id,
        range_start: rangeStart.toISOString(),
        range_end: rangeEnd.toISOString(),
        required_coverage_hours: toHours(requiredCoverageMinutes),
        requested_target_hours_total: toHours(totalAdjustedMinutes),
        missing_hours: toHours(requiredCoverageMinutes - totalAdjustedMinutes),
      }
    );
  }

  const { allocationsByUser, gaps } = buildBulkRegeneratedIntervals({
    windows,
    userIds: selectedUserIds,
    targetMinutesByUser,
  });

  if (gaps.length > 0) {
    const formattedGaps = gaps.map(formatGap);
    const totalMissingMinutes = formattedGaps.reduce((sum, gap) => sum + (gap.minutes || 0), 0);
    throw new AppError(
      'Coverage check failed: adjustment leaves shop open-time gaps without staff',
      409,
      {
        error_code: 'COVERAGE_GAP_AFTER_ADJUSTMENT',
        shop_id: normalizeId(shop_id),
        shop_name: shop.name,
        range_start: rangeStart.toISOString(),
        range_end: rangeEnd.toISOString(),
        required_coverage_hours: toHours(requiredCoverageMinutes),
        achievable_coverage_hours_after_adjustment: toHours(
          requiredCoverageMinutes - totalMissingMinutes
        ),
        expected_missing_if_even_distribution_hours: 0,
        total_missing_minutes: totalMissingMinutes,
        total_missing_hours: toHours(totalMissingMinutes),
        gaps_count: formattedGaps.length,
        gaps: formattedGaps.slice(0, 10),
        uncovered_windows_preview: formattedGaps.slice(0, 3).map(formatGapLabel),
      }
    );
  }

  const batchId = randomUUID();
  const now = new Date();
  const docsToInsert = [];

  selectedUserIds.forEach((userId) => {
    const merged = mergeIntervals(allocationsByUser.get(userId) || []);
    merged.forEach((interval) => {
      const mins = minutesFromRange(interval.start, interval.end);
      if (mins <= 0) return;

      docsToInsert.push({
        user_id: userId,
        shop_id,
        punch_in: interval.start,
        punch_out: interval.end,
        punch_out_source: 'Manual',
        is_manual: true,
        manual_by: req.user._id,
        punch_method: 'Manual',
        adjusted_minutes: mins,
        adjusted_at: now,
        adjusted_by: req.user._id,
        adjustment_note: note || null,
        effective_start: interval.start,
        effective_end: interval.end,
        effective_minutes: mins,
        effective_source: 'Adjusted',
        is_active: true,
        replacement_batch_id: batchId,
      });
    });
  });

  if (docsToInsert.length === 0) {
    throw new AppError(
      'No regenerated attendance records were produced from requested targets',
      400
    );
  }

  await Attendance.updateMany(
    {
      shop_id,
      user_id: { $in: selectedUserIds },
      is_active: { $ne: false },
      punch_out: { $ne: null },
      punch_in: { $gte: rangeStart, $lte: rangeEnd },
    },
    {
      $set: {
        is_active: false,
        archived_at: now,
        archived_by: req.user._id,
        replacement_batch_id: batchId,
      },
    }
  );

  await Attendance.insertMany(docsToInsert);

  return sendSuccess(res, 'Bulk attendance hours adjustment applied successfully', {
    shop_id,
    shop_name: shop.name,
    from_date: rangeStart.toISOString(),
    to_date: rangeEnd.toISOString(),
    users_count: selectedUserIds.length,
    batch_id: batchId,
    totals: {
      required_coverage_hours: toHours(requiredCoverageMinutes),
      target_hours: toHours(totalAdjustedMinutes),
      regenerated_hours: toHours(
        docsToInsert.reduce((sum, doc) => sum + Math.max(0, Number(doc.effective_minutes) || 0), 0)
      ),
    },
    coverage_rebalanced: true,
    users: selectedUserIds.map((userId) => ({
      user_id: userId,
      target_hours: toHours(targetMinutesByUser.get(userId) || 0),
      regenerated_records_count: mergeIntervals(allocationsByUser.get(userId) || []).length,
    })),
  });
});

module.exports = {
  verifyLocation,
  punchIn,
  punchOut,
  manualPunchIn,
  getAttendance,
  getAttendanceSummaryByUser,
  getEligibleRotas,
  reconcileAllOverdue,
  reconcileSelfOverdue,
  previewClosedAttendanceAdjustment,
  applyClosedAttendanceAdjustment,
  bulkAdjustClosedAttendanceByShop,
  getUnchangedUsersForRange,
};
