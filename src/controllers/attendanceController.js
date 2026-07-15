const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Rota = require('../models/Rota');
const User = require('../models/User');
const Shop = require('../models/Shop');
const notificationService = require('../services/notificationService');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { parsePagination, toPageMeta } = require('../utils/pagination');
const { renderPayrollPdf } = require('../utils/payrollPdf');
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

const REPORT_MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const REPORT_WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// "28 Apr 2026" — matches the printed payroll report header format.
function formatReportDate(date) {
  const d = new Date(date);
  return `${d.getUTCDate()} ${REPORT_MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// "26 Apr 2026 14:22"
function formatReportDateTime(date) {
  const d = new Date(date);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatReportDate(d)} ${hh}:${mm}`;
}

// "22/04/2026"
function formatDDMMYYYY(date) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function reportWeekdayName(date) {
  return REPORT_WEEKDAY_NAMES[new Date(date).getUTCDay()];
}

function buildShopReportDisplayName(shop) {
  return shop.store_identifier ? `${shop.name}(${shop.store_identifier})` : shop.name;
}

function sumBreakMinutes(breaks) {
  if (!Array.isArray(breaks)) return 0;
  return breaks.reduce((sum, entry) => {
    if (!entry || !entry.break_end) return sum;
    const duration =
      entry.duration_minutes !== null && entry.duration_minutes !== undefined
        ? Number(entry.duration_minutes)
        : minutesBetween(entry.break_start, entry.break_end);
    return sum + Math.max(0, duration);
  }, 0);
}

function findOpenBreak(attendance) {
  return (attendance.breaks || []).find((entry) => !entry.break_end);
}

// Computed break fields attached to attendance records for admin/report screens.
function buildBreakSummary(record) {
  const breaks = record.breaks || [];
  const totalBreakMinutes = sumBreakMinutes(breaks);
  return {
    total_break_minutes: totalBreakMinutes,
    total_break_hours: toHours(totalBreakMinutes),
    breaks_count: breaks.length,
    is_on_break: Boolean(findOpenBreak(record)),
  };
}

function netMinutesBetween(punchIn, punchOut, breaks) {
  return Math.max(0, minutesBetween(punchIn, punchOut) - sumBreakMinutes(breaks));
}

// Per-document sum of closed break minutes, for use inside aggregation pipelines.
function breakMinutesExpr() {
  return {
    $sum: {
      $map: {
        input: { $ifNull: ['$breaks', []] },
        as: 'b',
        in: {
          $cond: [
            { $ne: ['$$b.break_end', null] },
            {
              $ifNull: [
                '$$b.duration_minutes',
                { $divide: [{ $subtract: ['$$b.break_end', '$$b.break_start'] }, 60000] },
              ],
            },
            0,
          ],
        },
      },
    },
  };
}

// Actual worked minutes = raw punch span minus closed break time.
function buildActualMinutesExpr() {
  return {
    $subtract: [
      {
        $cond: [
          { $and: [{ $ne: ['$punch_in', null] }, { $ne: ['$punch_out', null] }] },
          { $divide: [{ $subtract: ['$punch_out', '$punch_in'] }, 60000] },
          0,
        ],
      },
      breakMinutesExpr(),
    ],
  };
}

// Root viewers see raw actual minutes; everyone else sees the admin-adjusted
// effective/adjusted minutes when set, falling back to break-netted actual minutes.
function buildWorkMinutesExpr(isRootViewer) {
  const actualMinutesExpr = buildActualMinutesExpr();
  return isRootViewer
    ? actualMinutesExpr
    : { $ifNull: ['$effective_minutes', { $ifNull: ['$adjusted_minutes', actualMinutesExpr] }] };
}

function buildAttendanceMatch(filter) {
  const match = { ...filter };

  if (typeof match.user_id === 'string') match.user_id = toObjectIdIfValid(match.user_id);
  if (typeof match.shop_id === 'string') match.shop_id = toObjectIdIfValid(match.shop_id);
  if (match.shop_id?.$in) {
    match.shop_id = { $in: match.shop_id.$in.map((id) => toObjectIdIfValid(String(id))) };
  }

  return match;
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

// When closing_time < opening_time the shop's operating window for the last
// day in a range extends past midnight into the next calendar day.
// This helper computes the true end of coverage for a given rangeEnd.
function overnightEffectiveRangeEnd(shop, rangeEnd) {
  const sampleHours = resolveShopHoursForInstant(shop, rangeEnd);
  const openMin = parseHHMMToMinutes(sampleHours.opening_time);
  const closeMin = parseHHMMToMinutes(sampleHours.closing_time);
  if (openMin === null || closeMin === null || closeMin >= openMin) return rangeEnd;
  // Extend to closing time of the day after rangeEnd
  const nextDay = new Date(rangeEnd);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return combineDateWithMinuteOffset(nextDay, closeMin);
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

  // For overnight shops (closing < opening), the last day's window extends past midnight.
  // Use effectiveRangeEnd so that window is not incorrectly clipped at 23:59.
  const effectiveRangeEnd = overnightEffectiveRangeEnd(shop, rangeEnd);

  eachUtcDay(rangeStart, rangeEnd).forEach((day) => {
    const dayHours = resolveShopHoursForInstant(shop, day);
    const openMinute = parseHHMMToMinutes(dayHours.opening_time);
    const closeMinute = parseHHMMToMinutes(dayHours.closing_time);
    if (openMinute === null || closeMinute === null || closeMinute === openMinute) {
      throw new AppError('Shop opening_time/closing_time are invalid for coverage checks', 400);
    }

    const windowStart = combineDateWithMinuteOffset(day, openMinute);
    const windowEnd = combineDateWithMinuteOffset(day, closeMinute);
    if (closeMinute < openMinute) {
      windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);
    }

    if (windowEnd <= rangeStart || windowStart >= effectiveRangeEnd) return;

    const start = new Date(Math.max(windowStart.getTime(), rangeStart.getTime()));
    const end = new Date(Math.min(windowEnd.getTime(), effectiveRangeEnd.getTime()));
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

// Default shift-length limits for bulk-by-shop regeneration (overridable per
// request). A single generated shift must be >= min and <= max hours, so a
// large target is split into several shifts across days rather than one
// unrealistic 14–22h block.
const DEFAULT_BULK_MIN_SHIFT_MINUTES = 240; // 4h
const DEFAULT_BULK_MAX_SHIFT_MINUTES = 600; // 10h

// Allocate non-overlapping shifts across the shop's open windows, honouring
// min/max shift length and "at most one shift per user per open window".
//
// Invariants held:
//  - every emitted shift is within [minMinutes, maxMinutes]
//  - a user never has two overlapping shifts (single presence at a time)
//  - each open window is single-staffed (one user per instant)
//  - a user gets at most one shift per open window; targets larger than max
//    spill to later windows/days (multiple shifts)
//
// Anything that cannot be placed is surfaced (not silently overlapped):
//  - `gaps`: open-window time no eligible user could cover under the limits
//  - `leftoverByUser`: target minutes that did not fit in the available windows
function allocateBulkShiftsWithLimits({ windows, userIds, targetMinutesByUser, minMinutes, maxMinutes }) {
  const allocationsByUser = new Map(userIds.map((userId) => [userId, []]));
  const remaining = new Map(
    userIds.map((userId) => [userId, Math.max(0, Number(targetMinutesByUser.get(userId)) || 0)])
  );
  const gaps = [];

  for (const window of windows) {
    let cursor = new Date(window.start);
    const windowEnd = new Date(window.end);
    const usedInWindow = new Set();

    while (cursor < windowEnd) {
      const windowRem = minutesFromRange(cursor, windowEnd);
      // Remaining slice too short to host a valid (>= min) shift.
      if (windowRem < minMinutes) {
        gaps.push({ start: new Date(cursor), end: new Date(windowEnd) });
        break;
      }

      const eligible = userIds.filter(
        (userId) =>
          !usedInWindow.has(userId) && Math.max(0, Number(remaining.get(userId)) || 0) >= minMinutes
      );
      if (eligible.length === 0) {
        gaps.push({ start: new Date(cursor), end: new Date(windowEnd) });
        break;
      }

      const user = pickUserWithMostRemaining(eligible, remaining);
      const available = Math.max(0, Number(remaining.get(user)) || 0);
      let chunk = Math.min(available, maxMinutes, windowRem);

      // If the slice we'd leave behind is smaller than a full shift, extend the
      // current shift to swallow it when that stays within max and the user's
      // remaining — avoids stranding a sub-min tail.
      const tail = windowRem - chunk;
      if (tail > 0 && tail < minMinutes) {
        chunk += Math.max(0, Math.min(maxMinutes - chunk, available - chunk, tail));
      }

      const segmentEnd = new Date(cursor.getTime() + chunk * 60000);
      allocationsByUser.get(user).push({ start: new Date(cursor), end: segmentEnd });
      remaining.set(user, available - chunk);
      usedInWindow.add(user);
      cursor = segmentEnd;
    }
  }

  const leftoverByUser = new Map(
    userIds.map((userId) => [userId, Math.max(0, Number(remaining.get(userId)) || 0)])
  );
  return { allocationsByUser, gaps, leftoverByUser };
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

  // For overnight shops the operating window extends past midnight; extend
  // the punch_in ceiling so records starting after midnight are included.
  const queryRangeEnd = overnightEffectiveRangeEnd(shop, rangeEnd);

  const records = await Attendance.find({
    shop_id: shopId,
    is_active: { $ne: false },
    punch_in: { $lte: queryRangeEnd },
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
    actualMinutes: netMinutesBetween(record.punch_in, record.punch_out, record.breaks),
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
  // Device ID verification temporarily disabled — frontend is reporting issues with device_id detection.
  // Re-enable once the client-side device ID flow is stabilised.
  // const deviceId = req.headers['x-device-id'];
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

  // 4. Device ID check — TEMPORARILY DISABLED
  // Reason: device_id verification is failing on the client side; disabled until the
  // frontend device registration / detection flow is fixed. Restore this block to re-enable.
  // if (!req.user.device_id) {
  //   throw new AppError('No device registered. Please register device after login.', 403);
  // }
  // if (!deviceId || deviceId !== req.user.device_id) {
  //   throw new AppError('Device not recognised. Registered device ID mismatch.', 403);
  // }

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

  // Fire-and-forget: notify if this punch-in was late
  const shop = await Shop.findById(shop_id).select('name');
  notificationService.notifyLatePunchIn({
    attendance,
    rota: matchedRota,
    user: req.user,
    shopName: shop?.name,
  });

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
  if (findOpenBreak(attendance)) {
    throw new AppError('Please end your lunch break before punching out', 400);
  }

  attendance.punch_out = new Date();
  attendance.punch_out_source = 'Manual';
  await attendance.save();

  return sendSuccess(res, 'Punch-out successful', { attendance });
});

function hasPermission(user, permission) {
  return Boolean(user?.role_id?.permissions?.[permission]);
}

// Owner may always manage their own break. A non-owner needs the same
// permission that gates the manual-punch-in exception flow.
function assertCanActOnBreak(user, attendance) {
  const isOwner = attendance.user_id.toString() === user._id.toString();
  if (isOwner) return { isManual: false };

  if (!hasPermission(user, 'can_manual_punch')) {
    throw new AppError('Forbidden: not allowed to manage break for this staff member', 403);
  }
  return { isManual: true };
}

// ─────────────────────────────────────────────
// Start Lunch Break
// POST /api/attendance/:id/break-start
// Self-service by default; a manager/sub-manager with can_manual_punch may
// start a break on behalf of another staff member's open attendance record.
// ─────────────────────────────────────────────
const breakStart = asyncHandler(async (req, res) => {
  await runAutoPunchOutSweep();
  const attendance = await Attendance.findById(req.params.id);

  if (!attendance || attendance.is_active === false) {
    throw new AppError('Attendance record not found', 404);
  }
  if (attendance.punch_out) {
    throw new AppError('Cannot start a break on a shift that has already been punched out', 400);
  }

  const { isManual } = assertCanActOnBreak(req.user, attendance);

  if (findOpenBreak(attendance)) {
    throw new AppError('A break is already in progress', 400);
  }

  const breakType = req.body?.break_type === 'Other' ? 'Other' : 'Lunch';
  attendance.breaks.push({
    break_start: new Date(),
    break_type: breakType,
    is_manual: isManual,
    manual_by: isManual ? req.user._id : null,
  });
  await attendance.save();

  return sendSuccess(res, 'Break started successfully', { attendance });
});

// ─────────────────────────────────────────────
// End Lunch Break
// PUT /api/attendance/:id/break-end
// ─────────────────────────────────────────────
const breakEnd = asyncHandler(async (req, res) => {
  const attendance = await Attendance.findById(req.params.id);

  if (!attendance || attendance.is_active === false) {
    throw new AppError('Attendance record not found', 404);
  }

  assertCanActOnBreak(req.user, attendance);

  const openBreak = findOpenBreak(attendance);
  if (!openBreak) {
    throw new AppError('No break is currently in progress', 400);
  }

  const now = new Date();
  openBreak.break_end = now;
  openBreak.duration_minutes = minutesBetween(openBreak.break_start, now);
  await attendance.save();

  return sendSuccess(res, 'Break ended successfully', { attendance });
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

  // Fire-and-forget: notify admins of manual punch-in
  const shop = await Shop.findById(shop_id).select('name');
  notificationService.notifyManualPunchIn({
    attendance,
    performer: req.user,
    targetUser: populated.user_id,
    shopName: shop?.name,
  });

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
    (sum, record) => sum + netMinutesBetween(record.punch_in, record.punch_out, record.breaks),
    0
  );
  const adjustedMinutes = records.reduce((sum, record) => {
    if (record.effective_minutes !== null && record.effective_minutes !== undefined) {
      return sum + Math.max(0, Number(record.effective_minutes));
    }
    if (record.adjusted_minutes === null || record.adjusted_minutes === undefined) {
      return sum + netMinutesBetween(record.punch_in, record.punch_out, record.breaks);
    }
    return sum + Math.max(0, Number(record.adjusted_minutes));
  }, 0);

  const visibleRecords = records.map((record) => {
    const dto = record.toObject();
    if (!isRootViewer && record.effective_start && record.effective_end) {
      dto.punch_in = record.effective_start;
      dto.punch_out = record.effective_end;
    }
    return { ...dto, ...buildBreakSummary(record) };
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

// GET attendance by required date range with pagination + range totals
// GET /api/attendance/range
const getAttendanceByDateRange = asyncHandler(async (req, res) => {
  await runAutoPunchOutSweep();
  const roleName = String(req.user?.role_id?.role_name || '')
    .trim()
    .toLowerCase();
  const isRootViewer = roleName === 'root';
  const isAdminViewer = roleName === 'admin';

  const fromDate = toUtcStartOfDay(req.query.from_date);
  const toDate = toUtcEndOfDay(req.query.to_date);
  if (!fromDate || !toDate) {
    throw new AppError('from_date and to_date are required and must be valid ISO dates', 400);
  }
  if (toDate < fromDate) {
    throw new AppError('to_date must be greater than or equal to from_date', 400);
  }

  const scope = buildReadScope(req.user);
  const isGlobalViewer = scope.mode === 'all' || isAdminViewer;
  const filter = {
    is_active: { $ne: false },
    punch_in: {
      $gte: fromDate,
      $lte: toDate,
    },
  };
  const requestedShopId = req.query.shop_id ? String(req.query.shop_id) : null;
  const { page, limit, skip, sort } = parsePagination(req.query, {
    defaultSortBy: 'punch_in',
    allowedSortBy: ['punch_in', 'punch_out', 'createdAt', 'updatedAt'],
  });
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
      return sendSuccess(res, 'Attendance range records fetched successfully', {
        ...toPageMeta(0, page, limit, 0),
        from_date: fromDate.toISOString(),
        to_date: toDate.toISOString(),
        shop_id: requestedShopId,
        total_work_hours: 0,
        total_actual_hours: 0,
        total_break_hours: 0,
        records: [],
      });
    }
    if (!scope.shopScope.all) {
      filter.shop_id = { $in: scope.shopScope.ids };
    }
  }

  if (req.query.user_id && scope.mode !== 'self') filter.user_id = req.query.user_id;

  if (requestedShopId) {
    if (
      !isAdminViewer &&
      enforcedShopIds &&
      enforcedShopIds.length > 0 &&
      !enforcedShopIds.includes(requestedShopId)
    ) {
      return sendSuccess(res, 'Attendance range records fetched successfully', {
        ...toPageMeta(0, page, limit, 0),
        from_date: fromDate.toISOString(),
        to_date: toDate.toISOString(),
        shop_id: requestedShopId,
        total_work_hours: 0,
        total_actual_hours: 0,
        total_break_hours: 0,
        records: [],
      });
    }
    if (
      scope.mode === 'shops' &&
      !scope.shopScope.all &&
      !isShopAllowed(scope.shopScope, requestedShopId)
    ) {
      return sendSuccess(res, 'Attendance range records fetched successfully', {
        ...toPageMeta(0, page, limit, 0),
        from_date: fromDate.toISOString(),
        to_date: toDate.toISOString(),
        shop_id: requestedShopId,
        total_work_hours: 0,
        total_actual_hours: 0,
        total_break_hours: 0,
        records: [],
      });
    }
    filter.shop_id = requestedShopId;
  }

  const match = buildAttendanceMatch(filter);
  const actualMinutesExpr = buildActualMinutesExpr();
  const workMinutesExpr = buildWorkMinutesExpr(isRootViewer);

  const [total, records, totalsAgg] = await Promise.all([
    Attendance.countDocuments(filter),
    Attendance.find(filter)
      .populate('user_id', 'name email')
      .populate('shop_id', 'name')
      .populate('rota_id', 'shift_start shift_end shift_date start_time end_time note')
      .populate('manual_by', 'name email')
      .sort(sort)
      .skip(skip)
      .limit(limit),
    Attendance.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total_actual_minutes: { $sum: { $max: [0, actualMinutesExpr] } },
          total_work_minutes: { $sum: { $max: [0, workMinutesExpr] } },
          total_break_minutes: { $sum: breakMinutesExpr() },
        },
      },
    ]),
  ]);

  const totals = totalsAgg[0] || {
    total_actual_minutes: 0,
    total_work_minutes: 0,
    total_break_minutes: 0,
  };

  const visibleRecords = records.map((record) => {
    const dto = record.toObject();
    if (!isRootViewer && record.effective_start && record.effective_end) {
      dto.punch_in = record.effective_start;
      dto.punch_out = record.effective_end;
    }
    return { ...dto, ...buildBreakSummary(record) };
  });

  return sendSuccess(res, 'Attendance range records fetched successfully', {
    ...toPageMeta(total, page, limit, visibleRecords.length),
    from_date: fromDate.toISOString(),
    to_date: toDate.toISOString(),
    shop_id: requestedShopId,
    total_work_hours: toHours(totals.total_work_minutes || 0),
    total_actual_hours: toHours(totals.total_actual_minutes || 0),
    total_break_hours: toHours(totals.total_break_minutes || 0),
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

  const actualMinutesExpr = buildActualMinutesExpr();
  const workMinutesExpr = buildWorkMinutesExpr(isRootViewer);

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
        total_break_minutes: { $sum: breakMinutesExpr() },
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
        total_break_minutes: 1,
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
    total_break_hours: toHours(item.total_break_minutes || 0),
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

// GET attendance records for a shop's staff in a date range, grouped per staff member
// GET /api/attendance/staff-shifts
const getShopStaffShifts = asyncHandler(async (req, res) => {
  await runAutoPunchOutSweep();
  const roleName = String(req.user?.role_id?.role_name || '')
    .trim()
    .toLowerCase();
  const isRootViewer = roleName === 'root';
  const isAdminViewer = roleName === 'admin';

  const fromDate = toUtcStartOfDay(req.query.from_date);
  const toDate = toUtcEndOfDay(req.query.to_date);
  if (!fromDate || !toDate) {
    throw new AppError('from_date and to_date are required and must be valid ISO dates', 400);
  }
  if (toDate < fromDate) {
    throw new AppError('to_date must be greater than or equal to from_date', 400);
  }

  const requestedShopId = req.query.shop_id ? String(req.query.shop_id) : null;

  const scope = buildReadScope(req.user);
  const isGlobalViewer = scope.mode === 'all' || isAdminViewer;
  const { page, limit, skip } = parsePagination(req.query, {
    defaultSortBy: 'createdAt',
    allowedSortBy: ['createdAt'],
  });
  const sortBy = String(req.query.sort_by || 'total_work_hours').trim();
  const sortDir = String(req.query.sort_dir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const shiftOrder = String(req.query.shift_order || 'asc').toLowerCase() === 'desc' ? -1 : 1;

  const emptyResponse = () =>
    sendSuccess(res, 'Shop staff shifts fetched successfully', {
      ...toPageMeta(0, page, limit, 0),
      from_date: fromDate.toISOString(),
      to_date: toDate.toISOString(),
      shop_id: requestedShopId,
      user_id: req.query.user_id || null,
      sort_by: sortBy,
      sort_dir: sortDir === 1 ? 'asc' : 'desc',
      total_work_hours: 0,
      total_actual_hours: 0,
      total_break_hours: 0,
      staff: [],
    });

  let enforcedShopIds = null;
  if (!isRootViewer && isGlobalViewer) {
    const shopScope = buildShopScope(req.user);
    enforcedShopIds = Array.isArray(shopScope.ids) ? shopScope.ids.map((id) => String(id)) : [];
  }

  if (requestedShopId) {
    if (
      !isRootViewer &&
      isGlobalViewer &&
      !isAdminViewer &&
      enforcedShopIds &&
      enforcedShopIds.length > 0 &&
      !enforcedShopIds.includes(requestedShopId)
    ) {
      return emptyResponse();
    }
    if (
      scope.mode === 'shops' &&
      !scope.shopScope.all &&
      !isShopAllowed(scope.shopScope, requestedShopId)
    ) {
      return emptyResponse();
    }
  } else if (scope.mode === 'shops' && !scope.shopScope.all && scope.shopScope.ids.length === 0) {
    // Shop-scoped viewer with no assigned shops and no explicit shop_id — nothing to show.
    return emptyResponse();
  }

  if (scope.mode === 'self') {
    // Self-scope users may only see their own data even when scoped to a shop.
    if (req.query.user_id && String(req.query.user_id) !== String(req.user._id)) {
      return emptyResponse();
    }
  }

  const filter = {
    is_active: { $ne: false },
    punch_in: { $gte: fromDate, $lte: toDate },
  };

  if (requestedShopId) {
    filter.shop_id = requestedShopId;
  } else if (scope.mode === 'shops' && !scope.shopScope.all) {
    // No shop_id given — restrict to every shop this manager is assigned to.
    filter.shop_id = { $in: scope.shopScope.ids };
  } else if (!isRootViewer && isGlobalViewer && !isAdminViewer && enforcedShopIds?.length > 0) {
    filter.shop_id = { $in: enforcedShopIds };
  }

  if (scope.mode === 'self') {
    filter.user_id = req.user._id;
  } else if (req.query.user_id) {
    filter.user_id = req.query.user_id;
  }

  const match = buildAttendanceMatch(filter);
  const actualMinutesExpr = buildActualMinutesExpr();
  const workMinutesExpr = buildWorkMinutesExpr(isRootViewer);

  const sortStage =
    sortBy === 'name'
      ? { name: sortDir, total_work_minutes: -1 }
      : { total_work_minutes: sortDir, name: 1 };

  const [result, totalsAgg] = await Promise.all([
    Attendance.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$user_id',
          records_count: { $sum: 1 },
          total_actual_minutes: { $sum: { $max: [0, actualMinutesExpr] } },
          total_work_minutes: { $sum: { $max: [0, workMinutesExpr] } },
          total_break_minutes: { $sum: breakMinutesExpr() },
          first_punch_in: { $min: '$punch_in' },
          last_punch_out: { $max: '$punch_out' },
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
          total_break_minutes: 1,
          first_punch_in: 1,
          last_punch_out: 1,
        },
      },
      { $sort: sortStage },
      {
        $facet: {
          meta: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]),
    Attendance.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total_actual_minutes: { $sum: { $max: [0, actualMinutesExpr] } },
          total_work_minutes: { $sum: { $max: [0, workMinutesExpr] } },
          total_break_minutes: { $sum: breakMinutesExpr() },
        },
      },
    ]),
  ]);

  const aggResult = result[0] || { meta: [], data: [] };
  const total = aggResult.meta?.[0]?.total || 0;
  const userBuckets = aggResult.data || [];
  const totals = totalsAgg[0] || {
    total_actual_minutes: 0,
    total_work_minutes: 0,
    total_break_minutes: 0,
  };

  let shiftsByUser = new Map();
  if (userBuckets.length > 0) {
    const userIds = userBuckets.map((b) => b.user_id);
    const records = await Attendance.find({ ...filter, user_id: { $in: userIds } })
      .populate('shop_id', 'name')
      .populate('rota_id', 'shift_start shift_end shift_date start_time end_time note')
      .populate('manual_by', 'name email')
      .sort({ punch_in: shiftOrder });

    for (const record of records) {
      const dto = record.toObject();
      if (!isRootViewer && record.effective_start && record.effective_end) {
        dto.punch_in = record.effective_start;
        dto.punch_out = record.effective_end;
      }
      const workMinutes = isRootViewer
        ? netMinutesBetween(record.punch_in, record.punch_out, record.breaks)
        : (record.effective_minutes ??
          record.adjusted_minutes ??
          netMinutesBetween(record.punch_in, record.punch_out, record.breaks));
      dto.work_minutes = Math.max(0, Math.round(workMinutes || 0));
      dto.work_hours = toHours(dto.work_minutes);
      dto.shift_date = record.punch_in
        ? new Date(record.punch_in).toISOString().slice(0, 10)
        : null;
      Object.assign(dto, buildBreakSummary(record));

      const key = String(record.user_id);
      if (!shiftsByUser.has(key)) shiftsByUser.set(key, []);
      shiftsByUser.get(key).push(dto);
    }
  }

  const staff = userBuckets.map((bucket) => ({
    user_id: String(bucket.user_id),
    name: bucket.name,
    email: bucket.email,
    records_count: bucket.records_count,
    total_work_minutes: Math.round(bucket.total_work_minutes || 0),
    total_work_hours: toHours(bucket.total_work_minutes || 0),
    total_actual_minutes: Math.round(bucket.total_actual_minutes || 0),
    total_actual_hours: toHours(bucket.total_actual_minutes || 0),
    total_break_minutes: Math.round(bucket.total_break_minutes || 0),
    total_break_hours: toHours(bucket.total_break_minutes || 0),
    first_punch_in: bucket.first_punch_in || null,
    last_punch_out: bucket.last_punch_out || null,
    shifts: shiftsByUser.get(String(bucket.user_id)) || [],
  }));

  return sendSuccess(res, 'Shop staff shifts fetched successfully', {
    ...toPageMeta(total, page, limit, staff.length),
    from_date: fromDate.toISOString(),
    to_date: toDate.toISOString(),
    shop_id: requestedShopId,
    user_id: req.query.user_id || null,
    sort_by: sortBy,
    sort_dir: sortDir === 1 ? 'asc' : 'desc',
    shift_order: shiftOrder === 1 ? 'asc' : 'desc',
    total_work_hours: toHours(totals.total_work_minutes || 0),
    total_actual_hours: toHours(totals.total_actual_minutes || 0),
    total_break_hours: toHours(totals.total_break_minutes || 0),
    staff,
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

// Shared validation + allocation for bulk-by-shop adjustment. Structural
// problems (bad input, unknown/foreign users, invalid limits) throw 400/404.
// "Business" problems (unselected users, coverage shortfall, gaps, hours that
// won't fit under the shift limits) are collected into `issues` and `feasible`
// so Preview can report them and Apply can 409 on them.
async function buildBulkAdjustmentPlan(req) {
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

  // Per-request shift-length limits, defaulting to 4h/10h.
  const minMinutes =
    req.body.min_shift_hours !== undefined
      ? Math.round(Number(req.body.min_shift_hours) * 60)
      : DEFAULT_BULK_MIN_SHIFT_MINUTES;
  const maxMinutes =
    req.body.max_shift_hours !== undefined
      ? Math.round(Number(req.body.max_shift_hours) * 60)
      : DEFAULT_BULK_MAX_SHIFT_MINUTES;
  if (
    !Number.isFinite(minMinutes) ||
    !Number.isFinite(maxMinutes) ||
    minMinutes <= 0 ||
    maxMinutes <= 0
  ) {
    throw new AppError('min_shift_hours and max_shift_hours must be positive numbers', 400);
  }
  if (minMinutes > maxMinutes) {
    throw new AppError('min_shift_hours must be less than or equal to max_shift_hours', 400);
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

  const { windows, requiredCoverageMinutes } = buildShopCoverageWindows(shop, rangeStart, rangeEnd);
  if (windows.length === 0) {
    throw new AppError('No shop open-time windows found inside the selected date range', 400);
  }

  const totalTargetMinutes = selectedUserIds.reduce(
    (sum, userId) => sum + Math.max(0, Number(targetMinutesByUser.get(userId)) || 0),
    0
  );

  const { allocationsByUser, gaps, leftoverByUser } = allocateBulkShiftsWithLimits({
    windows,
    userIds: selectedUserIds,
    targetMinutesByUser,
    minMinutes,
    maxMinutes,
  });

  const formattedGaps = gaps.map(formatGap);
  const totalMissingMinutes = formattedGaps.reduce((sum, gap) => sum + (gap.minutes || 0), 0);
  const leftoverUsers = selectedUserIds
    .filter((userId) => (Number(leftoverByUser.get(userId)) || 0) > 0)
    .map((userId) => ({
      user_id: userId,
      unallocated_hours: toHours(Number(leftoverByUser.get(userId)) || 0),
    }));

  // Blocking issues reject Apply with 409 (these are the SAME conditions the
  // endpoint rejected before this change, so the current frontend flow is
  // unaffected). Warnings never fail the request — they are surfaced in the
  // 200 response so the UI can optionally show them.
  const blockingIssues = [];
  const warnings = [];

  if (unchangedUsers.length > 0) {
    blockingIssues.push({
      error_code: 'UNSELECTED_USERS_IN_RANGE',
      message:
        'Some users in this shop/date range are not selected. Include all users or adjust your date range.',
      detail: { unchanged_users: unchangedUsers },
    });
  }
  if (totalTargetMinutes < requiredCoverageMinutes) {
    blockingIssues.push({
      error_code: 'INSUFFICIENT_TARGET_HOURS_FOR_COVERAGE',
      message: 'Coverage check failed: total target hours are below required shop open coverage',
      detail: {
        shop_id: normalizeId(shop_id),
        required_coverage_hours: toHours(requiredCoverageMinutes),
        requested_target_hours_total: toHours(totalTargetMinutes),
        missing_hours: toHours(requiredCoverageMinutes - totalTargetMinutes),
      },
    });
  }
  if (formattedGaps.length > 0) {
    warnings.push({
      error_code: 'COVERAGE_GAP_AFTER_ADJUSTMENT',
      message:
        'Some shop open-time could not be staffed under the min/max shift limits (applied with gaps)',
      detail: {
        shop_id: normalizeId(shop_id),
        shop_name: shop.name,
        required_coverage_hours: toHours(requiredCoverageMinutes),
        achievable_coverage_hours_after_adjustment: toHours(
          requiredCoverageMinutes - totalMissingMinutes
        ),
        total_missing_minutes: totalMissingMinutes,
        total_missing_hours: toHours(totalMissingMinutes),
        gaps_count: formattedGaps.length,
        gaps: formattedGaps.slice(0, 10),
        uncovered_windows_preview: formattedGaps.slice(0, 3).map(formatGapLabel),
      },
    });
  }
  if (leftoverUsers.length > 0) {
    warnings.push({
      error_code: 'UNALLOCATED_TARGET_HOURS',
      message:
        'Some target hours could not be placed within shop open hours under the min/max shift limits',
      detail: { users: leftoverUsers },
    });
  }

  return {
    shop,
    shopId: shop_id,
    rangeStart,
    rangeEnd,
    note,
    minMinutes,
    maxMinutes,
    selectedUserIds,
    targetMinutesByUser,
    requiredCoverageMinutes,
    totalTargetMinutes,
    allocationsByUser,
    leftoverByUser,
    formattedGaps,
    blockingIssues,
    warnings,
    canApply: blockingIssues.length === 0,
  };
}

// Shared per-user shift breakdown + totals used by both Preview and Apply.
// The shape is a strict SUPERSET of the pre-change response (legacy keys
// `totals.regenerated_hours` and `users[].regenerated_records_count` are kept)
// so the existing frontend needs no changes.
function buildBulkPlanResponse(plan) {
  const users = plan.selectedUserIds.map((userId) => {
    const merged = mergeIntervals(plan.allocationsByUser.get(userId) || []);
    const allocatedMinutes = merged.reduce(
      (sum, interval) => sum + minutesFromRange(interval.start, interval.end),
      0
    );
    return {
      user_id: userId,
      target_hours: toHours(plan.targetMinutesByUser.get(userId) || 0),
      allocated_hours: toHours(allocatedMinutes),
      unallocated_hours: toHours(Number(plan.leftoverByUser.get(userId)) || 0),
      shift_count: merged.length,
      // legacy alias (old key name)
      regenerated_records_count: merged.length,
      shifts: merged.map((interval) => ({
        punch_in: interval.start.toISOString(),
        punch_out: interval.end.toISOString(),
        hours: toHours(minutesFromRange(interval.start, interval.end)),
      })),
    };
  });

  const allocatedTotal = users.reduce((sum, u) => sum + Math.round((u.allocated_hours || 0) * 60), 0);

  return {
    shop_id: normalizeId(plan.shopId),
    shop_name: plan.shop.name,
    from_date: plan.rangeStart.toISOString(),
    to_date: plan.rangeEnd.toISOString(),
    users_count: plan.selectedUserIds.length,
    coverage_rebalanced: true,
    limits: {
      min_shift_hours: toHours(plan.minMinutes),
      max_shift_hours: toHours(plan.maxMinutes),
    },
    totals: {
      required_coverage_hours: toHours(plan.requiredCoverageMinutes),
      target_hours: toHours(plan.totalTargetMinutes),
      allocated_hours: toHours(allocatedTotal),
      // legacy alias (old key name)
      regenerated_hours: toHours(allocatedTotal),
    },
    // New, additive informational fields:
    can_apply: plan.canApply,
    blocking_issues: plan.blockingIssues,
    warnings: plan.warnings,
    has_gaps: plan.formattedGaps.length > 0,
    gaps: plan.formattedGaps.slice(0, 20),
    users,
  };
}

// POST /api/attendance/adjust-hours/bulk-by-shop/preview — dry run, no writes.
const previewBulkAdjustClosedAttendanceByShop = asyncHandler(async (req, res) => {
  const plan = await buildBulkAdjustmentPlan(req);
  return sendSuccess(res, 'Bulk attendance adjustment preview generated', {
    ...buildBulkPlanResponse(plan),
    preview: true,
  });
});

const bulkAdjustClosedAttendanceByShop = asyncHandler(async (req, res) => {
  const plan = await buildBulkAdjustmentPlan(req);

  // Only the pre-existing conditions (unselected users, total hours below
  // coverage) reject the request — same 409 behavior as before. Coverage gaps
  // or unallocatable hours introduced purely by the min/max limits are applied
  // and reported as warnings, so the current frontend flow still gets 200.
  if (!plan.canApply) {
    const primary = plan.blockingIssues[0];
    throw new AppError(primary.message, 409, {
      error_code: primary.error_code,
      ...primary.detail,
      can_apply: false,
      blocking_issues: plan.blockingIssues,
      warnings: plan.warnings,
    });
  }

  const { shopId, rangeStart, rangeEnd, selectedUserIds, allocationsByUser, note } = plan;
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
        shop_id: shopId,
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
      shop_id: shopId,
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

  // Fire-and-forget: notify admins of bulk adjustment
  notificationService.notifyAttendanceAdjusted({
    batchId,
    performer: req.user,
    shopId,
    shopName: plan.shop.name,
    affectedCount: selectedUserIds.length,
  });

  return sendSuccess(res, 'Bulk attendance hours adjustment applied successfully', {
    ...buildBulkPlanResponse(plan),
    applied: true,
    batch_id: batchId,
  });
});

const getWeeklyPayrollReport = asyncHandler(async (req, res) => {
  const { shop_id, from_date, to_date } = req.query;

  if (!shop_id) throw new AppError('shop_id is required', 400);
  if (!from_date || !to_date) throw new AppError('from_date and to_date are required', 400);

  const start = new Date(from_date);
  const end = new Date(to_date);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new AppError('Invalid from_date or to_date format', 400);
  }

  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);

  const shop = await Shop.findById(shop_id).select('name store_identifier');
  if (!shop) throw new AppError('Shop not found', 404);

  const shopScope = buildShopScope(req.user);
  if (!shopScope.all && !isShopAllowed(shopScope, shop_id)) {
    throw new AppError('You do not have access to this shop', 403);
  }

  const dateStrArray = [];
  let current = new Date(start);
  while (current <= end) {
    dateStrArray.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  const query = {
    shop_id,
    punch_in: { $gte: start, $lte: end },
    is_active: { $ne: false },
  };

  const records = await Attendance.find(query)
    .populate('user_id', 'name email first_name last_name payroll_id')
    .sort({ punch_in: 1 })
    .lean();

  const toHHMM = (date) => {
    if (!date) return '';
    const d = new Date(date);
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };

  const employeesMap = {};

  records.forEach((record) => {
    if (!record.user_id) return;
    const uId = String(record.user_id._id);
    if (!employeesMap[uId]) {
      const name =
        record.user_id.name ||
        `${record.user_id.first_name || ''} ${record.user_id.last_name || ''}`.trim();
      const email = record.user_id.email || null;
      employeesMap[uId] = {
        user_id: uId,
        payroll_id: record.user_id.payroll_id || null,
        employee_name: name,
        name,
        email,
        user: { id: uId, name, email },
        daysMap: {},
        weekly_total: { total_before_adj: 0, total_adj: 0, adj_amount: 0, total_break_hours: 0 },
      };
      dateStrArray.forEach((d) => {
        employeesMap[uId].daysMap[d] = {
          date: d,
          punches: [],
          total_before_adj: 0,
          total_adj: 0,
          adj_amount: 0,
          total_break_hours: 0,
        };
      });
    }

    const dateKey = record.punch_in.toISOString().split('T')[0];
    const dayData = employeesMap[uId].daysMap[dateKey];

    if (!dayData) return;

    let inTime = toHHMM(record.punch_in);
    let outTime = toHHMM(record.punch_out);
    let sysFlag = record.punch_out_source === 'Auto' ? '^' : '';
    let manFlag = record.is_manual ? '*' : '';

    let timeLabel = `${inTime}-${outTime}${sysFlag}${manFlag}`;

    let diffMinutes = 0;
    if (record.punch_in && record.punch_out) {
      diffMinutes = (new Date(record.punch_out) - new Date(record.punch_in)) / 60000;
    }
    const breakMinutesForRecord = sumBreakMinutes(record.breaks);
    diffMinutes = Math.max(0, diffMinutes - breakMinutesForRecord);
    const beforeAdjHours = parseFloat((Math.max(0, diffMinutes) / 60).toFixed(2));
    const breakHours = parseFloat((breakMinutesForRecord / 60).toFixed(2));

    let afterAdjHours = beforeAdjHours;
    if (record.effective_minutes != null) {
      afterAdjHours = parseFloat((record.effective_minutes / 60).toFixed(2));
    } else if (record.adjusted_minutes != null) {
      afterAdjHours = parseFloat((record.adjusted_minutes / 60).toFixed(2));
    }

    dayData.punches.push({
      time_label: timeLabel,
      hours: afterAdjHours,
      break_hours: breakHours,
      is_system: record.punch_out_source === 'Auto',
      is_manual: record.is_manual || false,
    });

    dayData.total_before_adj += beforeAdjHours;
    dayData.total_adj += afterAdjHours;
    dayData.total_break_hours += breakHours;
  });

  const grand_totals = {
    daysMap: {},
    weekly_total: { total_before_adj: 0, total_adj: 0, adj_amount: 0, total_break_hours: 0 },
  };
  dateStrArray.forEach((d) => {
    grand_totals.daysMap[d] = {
      total_before_adj: 0,
      total_adj: 0,
      adj_amount: 0,
      total_break_hours: 0,
    };
  });

  const employees = Object.values(employeesMap)
    .map((emp) => {
      const days = dateStrArray.map((d) => {
        const dayData = emp.daysMap[d];
        dayData.total_before_adj = parseFloat(dayData.total_before_adj.toFixed(2));
        dayData.total_adj = parseFloat(dayData.total_adj.toFixed(2));
        dayData.adj_amount = parseFloat((dayData.total_adj - dayData.total_before_adj).toFixed(2));
        dayData.total_break_hours = parseFloat(dayData.total_break_hours.toFixed(2));

        emp.weekly_total.total_before_adj += dayData.total_before_adj;
        emp.weekly_total.total_adj += dayData.total_adj;
        emp.weekly_total.total_break_hours += dayData.total_break_hours;

        grand_totals.daysMap[d].total_before_adj += dayData.total_before_adj;
        grand_totals.daysMap[d].total_adj += dayData.total_adj;
        grand_totals.daysMap[d].total_break_hours += dayData.total_break_hours;

        return dayData;
      });

      emp.weekly_total.total_before_adj = parseFloat(emp.weekly_total.total_before_adj.toFixed(2));
      emp.weekly_total.total_adj = parseFloat(emp.weekly_total.total_adj.toFixed(2));
      emp.weekly_total.adj_amount = parseFloat(
        (emp.weekly_total.total_adj - emp.weekly_total.total_before_adj).toFixed(2)
      );
      emp.weekly_total.total_break_hours = parseFloat(
        emp.weekly_total.total_break_hours.toFixed(2)
      );

      grand_totals.weekly_total.total_before_adj += emp.weekly_total.total_before_adj;
      grand_totals.weekly_total.total_adj += emp.weekly_total.total_adj;
      grand_totals.weekly_total.total_break_hours += emp.weekly_total.total_break_hours;

      delete emp.daysMap;
      emp.days = days;
      // Alias matching the printed report's "Hrs Wrkd" column.
      emp.hrs_wrkd = emp.weekly_total.total_adj;
      return emp;
    })
    .sort((a, b) => a.employee_name.localeCompare(b.employee_name));

  Object.values(grand_totals.daysMap).forEach((gd) => {
    gd.total_before_adj = parseFloat(gd.total_before_adj.toFixed(2));
    gd.total_adj = parseFloat(gd.total_adj.toFixed(2));
    gd.adj_amount = parseFloat((gd.total_adj - gd.total_before_adj).toFixed(2));
    gd.total_break_hours = parseFloat(gd.total_break_hours.toFixed(2));
  });
  const grandDays = dateStrArray.map((d) => ({ date: d, ...grand_totals.daysMap[d] }));

  grand_totals.weekly_total.total_before_adj = parseFloat(
    grand_totals.weekly_total.total_before_adj.toFixed(2)
  );
  grand_totals.weekly_total.total_adj = parseFloat(grand_totals.weekly_total.total_adj.toFixed(2));
  grand_totals.weekly_total.adj_amount = parseFloat(
    (grand_totals.weekly_total.total_adj - grand_totals.weekly_total.total_before_adj).toFixed(2)
  );
  grand_totals.weekly_total.total_break_hours = parseFloat(
    grand_totals.weekly_total.total_break_hours.toFixed(2)
  );

  const reportData = {
    report_title: 'Weekly Printed Payroll Report',
    shop: {
      id: shop_id,
      name: shop.name,
      store_identifier: shop.store_identifier || null,
      display_name: buildShopReportDisplayName(shop),
    },
    date_range: {
      from: dateStrArray[0],
      to: dateStrArray[dateStrArray.length - 1],
    },
    week_ending: formatReportDate(end),
    printed_at: formatReportDateTime(new Date()),
    legend: {
      system_punch: '^ Indicates system time punch',
      manual_punch: '* Indicates a user-edited time punch',
    },
    dates: dateStrArray,
    date_headers: dateStrArray.map((d) => ({
      date: d,
      date_label: formatDDMMYYYY(d),
      weekday: reportWeekdayName(d),
    })),
    employees,
    grand_totals: {
      days: grandDays,
      weekly_total: grand_totals.weekly_total,
    },
  };

  // Opt-in PDF output (?format=pdf). Default response stays JSON so existing
  // consumers are unaffected.
  if (String(req.query.format || '').toLowerCase() === 'pdf') {
    const buffer = await renderPayrollPdf(reportData);
    const safe = (s) =>
      String(s || '')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
    const filename = `weekly-payroll_${safe(shop.name)}_${dateStrArray[0]}_to_${
      dateStrArray[dateStrArray.length - 1]
    }.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  }

  return sendSuccess(res, 'Weekly payroll report generated successfully', reportData);
});

module.exports = {
  verifyLocation,
  punchIn,
  punchOut,
  breakStart,
  breakEnd,
  manualPunchIn,
  getAttendance,
  getAttendanceByDateRange,
  getAttendanceSummaryByUser,
  getShopStaffShifts,
  getEligibleRotas,
  reconcileAllOverdue,
  reconcileSelfOverdue,
  previewClosedAttendanceAdjustment,
  applyClosedAttendanceAdjustment,
  bulkAdjustClosedAttendanceByShop,
  previewBulkAdjustClosedAttendanceByShop,
  getUnchangedUsersForRange,
  getWeeklyPayrollReport,
};
