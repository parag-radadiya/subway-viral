'use strict';

const Notification = require('../models/Notification');
const User = require('../models/User');
const Rota = require('../models/Rota');
const Attendance = require('../models/Attendance');

const LATE_PUNCH_THRESHOLD_MINUTES = 30;

// ── Recipient resolution ─────────────────────────────────────────────────────
//
// Find all users with the given permission keys, optionally scoped to a shop.
// A user qualifies if any of:
//  - role.permissions[permKey] === true
//  - assigned_shop_ids includes the shop (when shopId provided)
//
// For shop-scoped events, we further filter to users whose shop assignment
// matches. Users without any assignment receive shop-wide notifications.

async function findRecipients({ permissions, shopId = null }) {
  // Note: filtering by role_id.permissions requires a populate + in-memory pass
  // because Mongoose can't query the populated path directly. Load all active
  // users, then filter by permission and (optionally) shop scope.
  const users = await User.find({ is_active: { $ne: false } })
    .populate({ path: 'role_id', select: 'permissions role_name' })
    .select('_id role_id assigned_shop_ids shop_id active_shop_id');

  return users.filter((user) => {
    const perms = user.role_id?.permissions || {};
    const hasPermission = permissions.some((p) => perms[p] === true);
    if (!hasPermission) return false;

    if (!shopId) return true;

    const assigned = Array.isArray(user.assigned_shop_ids) ? user.assigned_shop_ids : [];
    if (assigned.length === 0) return true; // unrestricted → notify
    return assigned.some((s) => String(s) === String(shopId));
  });
}

const PERMISSIONS_BY_CATEGORY = {
  attendance: ['can_view_all_staff', 'can_manage_rotas', 'can_adjust_attendance_hours'],
  inventory: ['can_manage_inventory'],
  rota: ['can_manage_rotas'],
  system: ['can_manage_shops', 'can_manage_roles', 'can_create_users'],
};

// ── Core emit ────────────────────────────────────────────────────────────────
//
// Insert one notification document per recipient. Dedupe via the dedupe_key
// unique partial index — if the same (recipient_id, dedupe_key) already exists
// the duplicate write is silently dropped.

// Extract the ObjectId from a value that may be a string, ObjectId, or
// a populated mongoose document.
function toObjectId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return value._id;
  return value;
}

async function emit({
  category,
  event_type,
  severity = 'info',
  title,
  message,
  shop_id = null,
  actor_id = null,
  target_user_id = null,
  attendance_id = null,
  rota_id = null,
  inventory_item_id = null,
  inventory_query_id = null,
  metadata = {},
  dedupe_key = null,
  recipients = null, // explicit list overrides auto-resolution
}) {
  // Normalise any populated docs to bare ObjectIds before persisting
  const normShop = toObjectId(shop_id);
  const normActor = toObjectId(actor_id);
  const normTarget = toObjectId(target_user_id);
  const normAttendance = toObjectId(attendance_id);
  const normRota = toObjectId(rota_id);
  const normItem = toObjectId(inventory_item_id);
  const normQuery = toObjectId(inventory_query_id);

  const perms = PERMISSIONS_BY_CATEGORY[category] || [];
  const resolved =
    Array.isArray(recipients) && recipients.length > 0
      ? recipients
      : await findRecipients({ permissions: perms, shopId: normShop });

  if (resolved.length === 0) return { created: 0, skipped: 0 };

  const docs = resolved.map((u) => ({
    recipient_id: toObjectId(u),
    category,
    event_type,
    severity,
    title,
    message,
    actor_id: normActor,
    shop_id: normShop,
    target_user_id: normTarget,
    attendance_id: normAttendance,
    rota_id: normRota,
    inventory_item_id: normItem,
    inventory_query_id: normQuery,
    metadata,
    dedupe_key,
  }));

  try {
    const res = await Notification.insertMany(docs, { ordered: false });
    return { created: res.length, skipped: 0 };
  } catch (err) {
    // bulk insert with some dedupe conflicts → succeed for the rest
    if (err?.writeErrors) {
      const skipped = err.writeErrors.length;
      const created = docs.length - skipped;
      return { created, skipped };
    }
    if (err?.code === 11000) return { created: 0, skipped: docs.length };
    throw err;
  }
}

// ── Helpers for each event type ──────────────────────────────────────────────
//
// Each helper is fire-and-forget — callers can `await` them or just log on error.

function safeEmit(payload) {
  return emit(payload).catch((err) => {
    console.error('[notificationService] emit failed:', err.message, {
      category: payload.category,
      event_type: payload.event_type,
    });
    return { created: 0, skipped: 0, error: err.message };
  });
}

// Attendance

async function notifyLatePunchIn({ attendance, rota, user, shopName }) {
  const lateMinutes = Math.round(
    (new Date(attendance.punch_in).getTime() - new Date(rota.shift_start).getTime()) / 60000
  );
  if (lateMinutes < LATE_PUNCH_THRESHOLD_MINUTES) return { created: 0, skipped: 0 };

  return safeEmit({
    category: 'attendance',
    event_type: 'LATE_PUNCH_IN',
    severity: lateMinutes >= 60 ? 'warning' : 'info',
    title: `${user?.name || 'Staff'} punched in late`,
    message: `${user?.name || 'Staff member'} punched in ${lateMinutes} minutes after the scheduled shift start at ${shopName || 'shop'}.`,
    shop_id: attendance.shop_id,
    target_user_id: attendance.user_id,
    attendance_id: attendance._id,
    rota_id: rota._id,
    metadata: {
      late_minutes: lateMinutes,
      shift_start: rota.shift_start,
      punch_in: attendance.punch_in,
    },
    dedupe_key: `LATE_PUNCH_IN::${attendance._id}`,
  });
}

async function notifyAutoPunchOut({ attendance, user, shopName }) {
  return safeEmit({
    category: 'attendance',
    event_type: 'AUTO_PUNCH_OUT',
    severity: 'warning',
    title: `${user?.name || 'Staff'} forgot to punch out`,
    message: `System auto-punched out ${user?.name || 'a staff member'} at ${shopName || 'shop'} 2 hours after shift end.`,
    shop_id: attendance.shop_id,
    target_user_id: attendance.user_id,
    attendance_id: attendance._id,
    rota_id: attendance.rota_id || null,
    metadata: { auto_punch_out_at: attendance.auto_punch_out_at, punch_out: attendance.punch_out },
    dedupe_key: `AUTO_PUNCH_OUT::${attendance._id}`,
  });
}

async function notifyMissedPunchIn({ rota, user, shopName, minutesAfter }) {
  return safeEmit({
    category: 'attendance',
    event_type: 'MISSED_PUNCH_IN',
    severity: 'critical',
    title: `${user?.name || 'Staff'} missed their punch-in`,
    message: `${user?.name || 'A staff member'} was scheduled at ${shopName || 'shop'} but has not punched in (${minutesAfter} minutes after shift start).`,
    shop_id: rota.shop_id,
    target_user_id: rota.user_id,
    rota_id: rota._id,
    metadata: {
      shift_start: rota.shift_start,
      shift_end: rota.shift_end,
      minutes_after: minutesAfter,
    },
    dedupe_key: `MISSED_PUNCH_IN::${rota._id}`,
  });
}

async function notifyMissedPunchOut({ attendance, rota, user, shopName }) {
  return safeEmit({
    category: 'attendance',
    event_type: 'MISSED_PUNCH_OUT',
    severity: 'warning',
    title: `${user?.name || 'Staff'} did not punch out on time`,
    message: `${user?.name || 'A staff member'} at ${shopName || 'shop'} did not punch out manually before their shift ended.`,
    shop_id: attendance.shop_id,
    target_user_id: attendance.user_id,
    attendance_id: attendance._id,
    rota_id: rota?._id || attendance.rota_id || null,
    metadata: { shift_end: rota?.shift_end, punch_in: attendance.punch_in },
    dedupe_key: `MISSED_PUNCH_OUT::${attendance._id}`,
  });
}

async function notifyManualPunchIn({ attendance, performer, targetUser, shopName }) {
  return safeEmit({
    category: 'attendance',
    event_type: 'MANUAL_PUNCH_IN',
    severity: 'info',
    title: `Manual punch-in for ${targetUser?.name || 'staff'}`,
    message: `${performer?.name || 'A manager'} manually punched in ${targetUser?.name || 'a staff member'} at ${shopName || 'shop'}.`,
    shop_id: attendance.shop_id,
    actor_id: performer?._id,
    target_user_id: attendance.user_id,
    attendance_id: attendance._id,
    metadata: { reason: 'Manual punch by authorised user' },
    dedupe_key: `MANUAL_PUNCH_IN::${attendance._id}`,
  });
}

async function notifyAttendanceAdjusted({ batchId, performer, shopId, shopName, affectedCount }) {
  return safeEmit({
    category: 'attendance',
    event_type: 'ATTENDANCE_ADJUSTED',
    severity: 'info',
    title: `Bulk attendance adjustment applied`,
    message: `${performer?.name || 'An admin'} adjusted hours for ${affectedCount} staff at ${shopName || 'shop'}.`,
    shop_id: shopId,
    actor_id: performer?._id,
    metadata: { batch_id: batchId, affected_count: affectedCount },
    dedupe_key: batchId ? `ATTENDANCE_ADJUSTED::${batchId}` : null,
  });
}

// Inventory

async function notifyInventoryQueryOpened({ query, performer, itemName, shopName }) {
  return safeEmit({
    category: 'inventory',
    event_type: 'INVENTORY_QUERY_OPENED',
    severity: 'warning',
    title: `Inventory issue reported: ${itemName || 'item'}`,
    message: `${performer?.name || 'Someone'} reported an issue with "${itemName || 'an item'}" at ${shopName || 'shop'}.`,
    shop_id: query.shop_id,
    actor_id: performer?._id,
    inventory_item_id: query.item_id,
    inventory_query_id: query._id,
    metadata: { issue_note: query.issue_note },
    dedupe_key: `INVENTORY_QUERY_OPENED::${query._id}`,
  });
}

async function notifyInventoryQueryClosed({ query, performer, itemName, shopName, repairCost }) {
  return safeEmit({
    category: 'inventory',
    event_type: 'INVENTORY_QUERY_CLOSED',
    severity: 'info',
    title: `Inventory issue resolved: ${itemName || 'item'}`,
    message: `${performer?.name || 'Someone'} closed the inventory ticket for "${itemName || 'an item'}" at ${shopName || 'shop'}${repairCost ? ` (repair cost: £${repairCost})` : ''}.`,
    shop_id: query.shop_id,
    actor_id: performer?._id,
    inventory_item_id: query.item_id,
    inventory_query_id: query._id,
    metadata: { repair_cost: repairCost },
    dedupe_key: `INVENTORY_QUERY_CLOSED::${query._id}`,
  });
}

async function notifyInventoryItemCreated({ item, performer, shopName }) {
  return safeEmit({
    category: 'inventory',
    event_type: 'INVENTORY_ITEM_CREATED',
    severity: 'info',
    title: `New inventory item: ${item.item_name}`,
    message: `${performer?.name || 'Someone'} added "${item.item_name}" to ${shopName || 'shop'}.`,
    shop_id: item.shop_id,
    actor_id: performer?._id,
    inventory_item_id: item._id,
    metadata: { stock_count: item.stock_count, status: item.status },
    dedupe_key: `INVENTORY_ITEM_CREATED::${item._id}`,
  });
}

async function notifyInventoryItemDamaged({ item, performer, shopName }) {
  return safeEmit({
    category: 'inventory',
    event_type: 'INVENTORY_ITEM_DAMAGED',
    severity: 'warning',
    title: `Item marked damaged: ${item.item_name}`,
    message: `"${item.item_name}" at ${shopName || 'shop'} has been marked as damaged.`,
    shop_id: item.shop_id,
    actor_id: performer?._id,
    inventory_item_id: item._id,
    metadata: { previous_status: 'Good', new_status: 'Damaged' },
    dedupe_key: `INVENTORY_ITEM_DAMAGED::${item._id}::${Date.now()}`,
  });
}

// Rota

async function notifyRotaPublished({ shopId, shopName, performer, weekStart, createdCount }) {
  return safeEmit({
    category: 'rota',
    event_type: 'ROTA_PUBLISHED',
    severity: 'info',
    title: `Rota published for week of ${new Date(weekStart).toISOString().slice(0, 10)}`,
    message: `${performer?.name || 'A manager'} published ${createdCount} rota entries at ${shopName || 'shop'}.`,
    shop_id: shopId,
    actor_id: performer?._id,
    metadata: { week_start: weekStart, created_count: createdCount },
    dedupe_key: `ROTA_PUBLISHED::${shopId}::${weekStart}`,
  });
}

// System

async function notifyShopHoursChanged({
  shop,
  performer,
  prevOpening,
  prevClosing,
  nextOpening,
  nextClosing,
}) {
  return safeEmit({
    category: 'system',
    event_type: 'SHOP_HOURS_CHANGED',
    severity: 'info',
    title: `Shop hours updated: ${shop.name}`,
    message: `${performer?.name || 'An admin'} changed ${shop.name} hours from ${prevOpening}–${prevClosing} to ${nextOpening}–${nextClosing}.`,
    shop_id: shop._id,
    actor_id: performer?._id,
    metadata: {
      prev_opening: prevOpening,
      prev_closing: prevClosing,
      next_opening: nextOpening,
      next_closing: nextClosing,
    },
    dedupe_key: `SHOP_HOURS_CHANGED::${shop._id}::${Date.now()}`,
  });
}

async function notifyUserCreated({ user, performer }) {
  return safeEmit({
    category: 'system',
    event_type: 'USER_CREATED',
    severity: 'info',
    title: `New user onboarded: ${user.name || user.email}`,
    message: `${performer?.name || 'An admin'} created an account for ${user.name || user.email}.`,
    actor_id: performer?._id,
    target_user_id: user._id,
    metadata: { email: user.email, role: user.role_id },
    dedupe_key: `USER_CREATED::${user._id}`,
  });
}

// ── Background scans ─────────────────────────────────────────────────────────
//
// Run periodically (cron) or on-demand via admin endpoint.

// ── Opportunistic scanning (replaces cron) ──────────────────────────────────
//
// Because the project has no VPC/cron infrastructure, we run the missed-punch
// scans opportunistically: on user login and on admin notification reads.
// A module-level cache throttles scans to once every MIN_SCAN_INTERVAL_MS
// regardless of how many requests come in, so heavy traffic doesn't hammer
// the DB.

const MIN_SCAN_INTERVAL_MS = Number(process.env.NOTIFICATION_SCAN_INTERVAL_MS) || 10 * 60 * 1000;
const lastScanAt = { all: 0, missed_punch_in: 0, missed_punch_out: 0 };
let inFlight = null;

async function maybeRunScan({ target = 'all', graceMinutes = 30 } = {}) {
  const now = Date.now();
  const last = lastScanAt[target] || 0;
  if (now - last < MIN_SCAN_INTERVAL_MS) {
    return { skipped: true, reason: 'throttled', last_scan_at: new Date(last).toISOString() };
  }

  // Coalesce: if a scan is already running, return its promise
  if (inFlight) return inFlight;

  lastScanAt[target] = now;
  inFlight = (async () => {
    const out = {};
    try {
      if (target === 'all' || target === 'missed_punch_in') {
        out.missed_punch_in = await scanForMissedPunchIns({ graceMinutes });
      }
      if (target === 'all' || target === 'missed_punch_out') {
        out.missed_punch_out = await scanForMissedPunchOuts();
      }
    } catch (err) {
      out.error = err.message;
       
      console.error('[notificationService] background scan failed:', err.message);
    }
    return out;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

// Fire-and-forget wrapper for opportunistic triggers (login, list endpoints).
// Caller does not await; errors are logged and swallowed.
function triggerBackgroundScan(opts) {
  setImmediate(() => {
    maybeRunScan(opts).catch((err) => {
       
      console.error('[notificationService] triggerBackgroundScan failed:', err.message);
    });
  });
}

async function scanForMissedPunchIns({ graceMinutes = 30 } = {}) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - graceMinutes * 60_000);

  // Rotas whose shift_start has passed by at least graceMinutes
  // and shift_end is still in the future (so they could still punch in)
  const candidates = await Rota.find({
    shift_start: { $lte: cutoff },
    shift_end: { $gte: now },
  })
    .populate('user_id', 'name email')
    .populate('shop_id', 'name');

  if (candidates.length === 0) return { scanned: 0, emitted: 0 };

  // For each rota, check if there's any attendance for that user covering the shift
  const rotaIds = candidates.map((r) => r._id);
  const punchedIn = await Attendance.find({
    rota_id: { $in: rotaIds },
    is_active: { $ne: false },
  }).select('rota_id');

  const punchedRotaIds = new Set(punchedIn.map((a) => String(a.rota_id)));
  const missed = candidates.filter((r) => !punchedRotaIds.has(String(r._id)));

  let emitted = 0;
  for (const rota of missed) {
    const minutesAfter = Math.round((now.getTime() - new Date(rota.shift_start).getTime()) / 60000);
    const result = await notifyMissedPunchIn({
      rota,
      user: rota.user_id,
      shopName: rota.shop_id?.name,
      minutesAfter,
    });
    emitted += result.created || 0;
  }

  return { scanned: candidates.length, emitted, missed_count: missed.length };
}

async function scanForMissedPunchOuts() {
  // Attendances where rota.shift_end has passed but punch_out is still null
  // and auto_punch_out hasn't fired yet
  const now = new Date();
  const candidates = await Attendance.find({
    punch_out: null,
    is_active: { $ne: false },
  })
    .populate({ path: 'rota_id', select: 'shift_end' })
    .populate('user_id', 'name email')
    .populate('shop_id', 'name');

  let emitted = 0;
  for (const att of candidates) {
    const shiftEnd = att.rota_id?.shift_end;
    if (!shiftEnd) continue;
    if (new Date(shiftEnd) > now) continue; // shift still ongoing

    const result = await notifyMissedPunchOut({
      attendance: att,
      rota: att.rota_id,
      user: att.user_id,
      shopName: att.shop_id?.name,
    });
    emitted += result.created || 0;
  }

  return { scanned: candidates.length, emitted };
}

module.exports = {
  emit,
  safeEmit,
  findRecipients,
  // attendance
  notifyLatePunchIn,
  notifyAutoPunchOut,
  notifyMissedPunchIn,
  notifyMissedPunchOut,
  notifyManualPunchIn,
  notifyAttendanceAdjusted,
  // inventory
  notifyInventoryQueryOpened,
  notifyInventoryQueryClosed,
  notifyInventoryItemCreated,
  notifyInventoryItemDamaged,
  // rota
  notifyRotaPublished,
  // system
  notifyShopHoursChanged,
  notifyUserCreated,
  // scans
  scanForMissedPunchIns,
  scanForMissedPunchOuts,
  maybeRunScan,
  triggerBackgroundScan,
  // constants
  LATE_PUNCH_THRESHOLD_MINUTES,
  MIN_SCAN_INTERVAL_MS,
  PERMISSIONS_BY_CATEGORY,
};
