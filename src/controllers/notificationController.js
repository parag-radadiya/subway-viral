const Notification = require('../models/Notification');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { parsePagination, toPageMeta } = require('../utils/pagination');
const notificationService = require('../services/notificationService');

const CATEGORIES = Notification.CATEGORIES;

function buildBaseFilter(req) {
  const filter = { recipient_id: req.user._id, archived_at: null };

  if (req.query.category) {
    const cat = String(req.query.category).toLowerCase();
    if (!CATEGORIES.includes(cat)) {
      throw new AppError(`category must be one of: ${CATEGORIES.join(', ')}`, 400);
    }
    filter.category = cat;
  }

  if (req.query.severity) {
    const sev = String(req.query.severity).toLowerCase();
    if (!Notification.SEVERITIES.includes(sev)) {
      throw new AppError(`severity must be one of: ${Notification.SEVERITIES.join(', ')}`, 400);
    }
    filter.severity = sev;
  }

  if (req.query.read === 'true') filter.read_at = { $ne: null };
  if (req.query.read === 'false') filter.read_at = null;

  if (req.query.shop_id) filter.shop_id = req.query.shop_id;

  return filter;
}

// Fire-and-forget opportunistic scan. Called from every notification read
// endpoint. Internally throttled so the actual DB scan only runs once every
// NOTIFICATION_SCAN_INTERVAL_MS (default 10 min) regardless of poll volume.
// Only triggered for users who can act on attendance notifications.
function maybeTriggerScanForRequest(req) {
  const perms = req.user?.role_id?.permissions || {};
  const canSeeAttendance =
    perms.can_view_all_staff || perms.can_manage_rotas || perms.can_adjust_attendance_hours;
  if (canSeeAttendance) {
    notificationService.triggerBackgroundScan({ target: 'all' });
  }
}

// GET /api/notifications
const listNotifications = asyncHandler(async (req, res) => {
  maybeTriggerScanForRequest(req);

  const filter = buildBaseFilter(req);
  const { page, limit, skip } = parsePagination(req.query, {
    defaultSortBy: 'createdAt',
    allowedSortBy: ['createdAt'],
  });

  const [total, items] = await Promise.all([
    Notification.countDocuments(filter),
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('actor_id', 'name email')
      .populate('target_user_id', 'name email')
      .populate('shop_id', 'name'),
  ]);

  return sendSuccess(res, 'Notifications fetched successfully', {
    ...toPageMeta(total, page, limit, items.length),
    notifications: items,
  });
});

// GET /api/notifications/unread-count
// Returns badge counts per category + total
const getUnreadCount = asyncHandler(async (req, res) => {
  maybeTriggerScanForRequest(req);

  const baseFilter = { recipient_id: req.user._id, archived_at: null, read_at: null };

  const [total, byCategory] = await Promise.all([
    Notification.countDocuments(baseFilter),
    Notification.aggregate([
      { $match: baseFilter },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
  ]);

  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  byCategory.forEach((row) => {
    categories[row._id] = row.count;
  });

  return sendSuccess(res, 'Unread notification counts fetched', {
    total,
    by_category: categories,
  });
});

// GET /api/notifications/summary
// Quick dashboard view: unread + recent items per category
const getSummary = asyncHandler(async (req, res) => {
  maybeTriggerScanForRequest(req);

  const baseFilter = { recipient_id: req.user._id, archived_at: null };

  const result = {};
  for (const cat of CATEGORIES) {
    const [unread, latest] = await Promise.all([
      Notification.countDocuments({ ...baseFilter, category: cat, read_at: null }),
      Notification.find({ ...baseFilter, category: cat })
        .sort({ createdAt: -1 })
        .limit(3)
        .populate('shop_id', 'name')
        .populate('target_user_id', 'name'),
    ]);

    result[cat] = { unread_count: unread, recent: latest };
  }

  return sendSuccess(res, 'Notification summary fetched', { categories: result });
});

// PATCH /api/notifications/:id/read
const markRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    recipient_id: req.user._id,
  });
  if (!notification) throw new AppError('Notification not found', 404);

  if (!notification.read_at) {
    notification.read_at = new Date();
    await notification.save();
  }

  return sendSuccess(res, 'Notification marked as read', { notification });
});

// POST /api/notifications/mark-all-read
const markAllRead = asyncHandler(async (req, res) => {
  const filter = {
    recipient_id: req.user._id,
    read_at: null,
    archived_at: null,
  };
  if (req.body?.category) {
    if (!CATEGORIES.includes(req.body.category)) {
      throw new AppError(`category must be one of: ${CATEGORIES.join(', ')}`, 400);
    }
    filter.category = req.body.category;
  }

  const result = await Notification.updateMany(filter, { $set: { read_at: new Date() } });
  return sendSuccess(res, 'Notifications marked as read', {
    modified: result.modifiedCount || 0,
    filter: { category: filter.category || 'all' },
  });
});

// DELETE /api/notifications/:id (soft archive)
const archiveNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient_id: req.user._id, archived_at: null },
    { $set: { archived_at: new Date() } },
    { new: true }
  );
  if (!notification) throw new AppError('Notification not found', 404);
  return sendSuccess(res, 'Notification archived', { notification });
});

// GET /api/notifications/categories
const listCategories = asyncHandler(async (_req, res) => {
  return sendSuccess(res, 'Notification categories fetched', {
    categories: CATEGORIES,
    severities: Notification.SEVERITIES,
    event_types: Notification.EVENT_TYPES,
  });
});

// POST /api/notifications/scan
// Admin/cron-style trigger: scan for missed punch-in / missed punch-out
const runScan = asyncHandler(async (req, res) => {
  const target = String(req.query.target || 'all').toLowerCase();
  const out = {};

  if (target === 'all' || target === 'missed_punch_in') {
    out.missed_punch_in = await notificationService.scanForMissedPunchIns({
      graceMinutes: Number(req.query.grace_minutes) || 30,
    });
  }
  if (target === 'all' || target === 'missed_punch_out') {
    out.missed_punch_out = await notificationService.scanForMissedPunchOuts();
  }

  return sendSuccess(res, 'Notification scan completed', out);
});

module.exports = {
  listNotifications,
  getUnreadCount,
  getSummary,
  markRead,
  markAllRead,
  archiveNotification,
  listCategories,
  runScan,
};
