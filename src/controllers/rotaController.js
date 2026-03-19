const Rota = require('../models/Rota');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { buildShopScope, isShopAllowed } = require('../middleware/shopScopeMiddleware');

function buildDates(weekStart, days) {
  const base = new Date(weekStart);
  base.setUTCHours(0, 0, 0, 0);
  const dayOfWeek = base.getUTCDay();
  const offsetToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  base.setUTCDate(base.getUTCDate() + offsetToMon);

  return days.map((d) => {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + d);
    return date;
  });
}

function combineDateAndTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  const [h, m] = String(timeValue).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(dateValue);
  d.setUTCHours(h, m, 0, 0);
  return d;
}

function normalizeTimeToHHMM(value) {
  if (!value) return null;
  const raw = String(value).trim();

  const hhmmMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmmMatch) {
    const h = Number(hhmmMatch[1]);
    const m = Number(hhmmMatch[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${String(parsed.getUTCHours()).padStart(2, '0')}:${String(parsed.getUTCMinutes()).padStart(2, '0')}`;
}

function normalizeBulkAssignments(assignments) {
  return assignments.map((assignment, idx) => {
    if (!assignment?.user_id) {
      throw new AppError(`Assignment #${idx + 1} requires user_id`, 400);
    }

    const startTime = normalizeTimeToHHMM(assignment.start_time || assignment.shift_start);
    const endTime = normalizeTimeToHHMM(assignment.end_time || assignment.shift_end);

    if (!startTime) {
      throw new AppError(
        `Assignment #${idx + 1} requires a valid start_time (HH:MM) or shift_start (ISO datetime)`,
        400
      );
    }
    if (!endTime) {
      throw new AppError(
        `Assignment #${idx + 1} requires a valid end_time (HH:MM) or shift_end (ISO datetime)`,
        400
      );
    }

    return {
      ...assignment,
      start_time: startTime,
      end_time: endTime,
    };
  });
}

function normalizeRotaPayload(payload) {
  const shiftStart = payload.shift_start
    ? new Date(payload.shift_start)
    : combineDateAndTime(payload.shift_date, payload.start_time);
  const shiftEnd = payload.shift_end
    ? new Date(payload.shift_end)
    : combineDateAndTime(payload.shift_date, payload.end_time);

  if (!shiftStart || Number.isNaN(shiftStart.getTime())) {
    throw new AppError('shift_start is required (or provide shift_date + start_time)', 400);
  }
  if (!shiftEnd || Number.isNaN(shiftEnd.getTime())) {
    throw new AppError('shift_end is required (or provide shift_date + end_time)', 400);
  }
  if (shiftEnd <= shiftStart) {
    throw new AppError('shift_end must be after shift_start', 400);
  }

  const shiftDate = new Date(shiftStart);
  shiftDate.setUTCHours(0, 0, 0, 0);

  return {
    ...payload,
    shift_start: shiftStart,
    shift_end: shiftEnd,
    shift_date: shiftDate,
  };
}

function weekBounds(weekStart) {
  const dates = buildDates(weekStart, [0, 1, 2, 3, 4, 5, 6]);
  const start = new Date(dates[0]);
  const end = new Date(dates[6]);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function buildRotaReadScope(user) {
  const permissions = user?.role_id?.permissions || {};
  if (permissions.can_manage_shops || permissions.can_manage_roles) {
    return { mode: 'all', shopScope: { all: true, ids: [] } };
  }

  if (permissions.can_view_all_staff || permissions.can_manage_inventory || permissions.can_manual_punch) {
    return { mode: 'shops', shopScope: buildShopScope(user) };
  }

  return { mode: 'self', shopScope: { all: false, ids: [] } };
}

function normalizeId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return value._id.toString();
  return value.toString();
}

function applyScopeFilter(filter, req, scope) {
  if (scope.mode === 'self') {
    filter.user_id = req.user._id;
    return;
  }

  if (scope.mode === 'shops') {
    if (!scope.shopScope.all && scope.shopScope.ids.length === 0) {
      filter.shop_id = { $in: [] };
      return;
    }
    if (!scope.shopScope.all) {
      filter.shop_id = { $in: scope.shopScope.ids };
    }
  }
}

function buildRotaManageScope(user) {
  const permissions = user?.role_id?.permissions || {};
  if (permissions.can_manage_shops || permissions.can_manage_roles) {
    return { mode: 'all', shopScope: { all: true, ids: [] } };
  }
  if (permissions.can_manage_rotas) {
    return { mode: 'shops', shopScope: buildShopScope(user) };
  }
  return { mode: 'none', shopScope: { all: false, ids: [] } };
}

function applyManageScopeFilter(filter, scope) {
  if (scope.mode === 'all') return;
  if (!scope.shopScope.all && scope.shopScope.ids.length === 0) {
    filter.shop_id = { $in: [] };
    return;
  }
  if (!scope.shopScope.all) {
    filter.shop_id = { $in: scope.shopScope.ids };
  }
}

function assertManageShopAllowed(scope, shopId) {
  if (scope.mode === 'all') return;
  if (!isShopAllowed(scope.shopScope, shopId)) {
    throw new AppError('Forbidden: shop is outside your assigned scope', 403);
  }
}

const getRotas = asyncHandler(async (req, res) => {
  const scope = buildRotaReadScope(req.user);
  const filter = {};
  applyScopeFilter(filter, req, scope);

  if (req.query.shop_id) {
    if (scope.mode === 'shops' && !scope.shopScope.all && !isShopAllowed(scope.shopScope, req.query.shop_id)) {
      return sendSuccess(res, 'Rota list fetched successfully', { count: 0, rotas: [] });
    }
    filter.shop_id = req.query.shop_id;
  }
  if (req.query.user_id && scope.mode !== 'self') filter.user_id = req.query.user_id;
  if (req.query.date) filter.shift_date = new Date(req.query.date);

  const rotas = await Rota.find(filter)
    .populate('user_id', 'name email')
    .populate('shop_id', 'name')
    .sort({ shift_start: 1 });

  return sendSuccess(res, 'Rota list fetched successfully', {
    count: rotas.length,
    rotas,
  });
});

const getRota = asyncHandler(async (req, res) => {
  const scope = buildRotaReadScope(req.user);
  const filter = { _id: req.params.id };
  applyScopeFilter(filter, req, scope);

  const rota = await Rota.findOne(filter)
    .populate('user_id', 'name email')
    .populate('shop_id', 'name');

  if (!rota) throw new AppError('Rota not found', 404);
  return sendSuccess(res, 'Rota fetched successfully', { rota });
});

const createRota = asyncHandler(async (req, res) => {
  const scope = buildRotaManageScope(req.user);
  assertManageShopAllowed(scope, req.body.shop_id);
  const payload = normalizeRotaPayload(req.body);

  try {
    const rota = await Rota.create(payload);
    const populated = await rota.populate([
      { path: 'user_id', select: 'name email' },
      { path: 'shop_id', select: 'name' },
    ]);
    return sendSuccess(res, 'Rota created successfully', { rota: populated }, 201);
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError('A rota entry for this user/shift_start already exists', 409);
    }
    throw err;
  }
});

const updateRota = asyncHandler(async (req, res) => {
  const scope = buildRotaManageScope(req.user);
  const existing = await Rota.findById(req.params.id);
  if (!existing) throw new AppError('Rota not found', 404);
  assertManageShopAllowed(scope, existing.shop_id);
  if (req.body.shop_id) assertManageShopAllowed(scope, req.body.shop_id);
  const mergedPayload = normalizeRotaPayload({ ...existing.toObject(), ...req.body });

  try {
    const rota = await Rota.findByIdAndUpdate(req.params.id, mergedPayload, {
      new: true,
      runValidators: true,
    })
      .populate('user_id', 'name email')
      .populate('shop_id', 'name');

    if (!rota) throw new AppError('Rota not found', 404);
    return sendSuccess(res, 'Rota updated successfully', { rota });
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError('Conflict: a rota with that user/shift_start already exists', 409);
    }
    throw err;
  }
});

const deleteRota = asyncHandler(async (req, res) => {
  const scope = buildRotaManageScope(req.user);
  const existing = await Rota.findById(req.params.id);
  if (!existing) throw new AppError('Rota not found', 404);
  assertManageShopAllowed(scope, existing.shop_id);

  const rota = await Rota.findByIdAndDelete(req.params.id);
  if (!rota) throw new AppError('Rota not found', 404);
  return sendSuccess(res, 'Rota deleted', { rota });
});

const bulkCreate = asyncHandler(async (req, res) => {
  const { shop_id, week_start, days, assignments, replace_existing = false } = req.body;

  if (!shop_id || !week_start || !Array.isArray(days) || !Array.isArray(assignments)) {
    throw new AppError('shop_id, week_start, days[], and assignments[] are all required', 400);
  }
  if (days.some((d) => d < 0 || d > 6)) {
    throw new AppError('days values must be 0 (Mon) - 6 (Sun)', 400);
  }
  const normalizedAssignments = normalizeBulkAssignments(assignments);

  const scope = buildRotaManageScope(req.user);
  assertManageShopAllowed(scope, shop_id);

  const dates = buildDates(week_start, days);
  const { start: weekStart, end: weekEnd } = weekBounds(week_start);
  const userIds = [...new Set(normalizedAssignments.map((a) => a.user_id))];

  if (replace_existing) {
    await Rota.deleteMany({
      shop_id,
      user_id: { $in: userIds },
      shift_date: { $gte: weekStart, $lte: weekEnd },
    });
  }

  const toInsert = [];
  for (const date of dates) {
    for (const assignment of normalizedAssignments) {
      const shiftStart = combineDateAndTime(date, assignment.start_time);
      const shiftEnd = combineDateAndTime(date, assignment.end_time);
      if (!shiftStart || !shiftEnd || shiftEnd <= shiftStart) {
        throw new AppError(
          `Invalid shift window for user ${assignment.user_id}. Ensure end_time is after start_time.`,
          400
        );
      }

      toInsert.push({
        user_id: assignment.user_id,
        shop_id,
        shift_date: date,
        shift_start: shiftStart,
        shift_end: shiftEnd,
        start_time: assignment.start_time,
        end_time: assignment.end_time,
        note: assignment.note || undefined,
      });
    }
  }

  let created = 0;
  const conflicts = [];

  const result = await Rota.insertMany(toInsert, { ordered: false }).catch((err) => {
    if (err.name === 'MongoBulkWriteError' || err.code === 11000) {
      created = err.result?.nInserted ?? err.insertedDocs?.length ?? 0;
      (err.writeErrors || []).forEach((we) => {
        const doc = we.err?.op || we.op || toInsert[we.index];
        if (doc) {
          conflicts.push({
            user_id: doc.user_id,
            date: doc.shift_date,
            start_time: doc.start_time,
            reason: 'Duplicate entry (user already has this shift)',
          });
        }
      });
      return null;
    }
    throw err;
  });

  if (result) created = result.length;

  return sendSuccess(
    res,
    `${created} rota entries created, ${conflicts.length} skipped (duplicates)`,
    {
      created,
      skipped: conflicts.length,
      conflicts,
    },
    201
  );
});

const getWeekView = asyncHandler(async (req, res) => {
  const { shop_id, week_start } = req.query;
  if (!week_start) {
    throw new AppError('week_start is required (YYYY-MM-DD)', 400);
  }

  const scope = buildRotaReadScope(req.user);
  const { start, end } = weekBounds(week_start);
  const filter = { shift_date: { $gte: start, $lte: end } };
  applyScopeFilter(filter, req, scope);

  if (shop_id) {
    if (scope.mode === 'shops' && !scope.shopScope.all && !isShopAllowed(scope.shopScope, shop_id)) {
      return sendSuccess(res, 'Weekly rota view fetched successfully', {
        week_start: start,
        week_end: end,
        shop_id,
        days: DAY_NAMES.reduce((acc, day, i) => {
          const d = buildDates(week_start, [i])[0];
          const label = `${day} ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
          acc[label] = [];
          return acc;
        }, {}),
      });
    }
    filter.shop_id = shop_id;
  }

  const rotas = await Rota.find(filter)
    .populate('user_id', 'name email phone_num')
    .populate('shop_id', 'name')
    .sort({ shift_start: 1 });

  const days = {};
  const allDates = buildDates(week_start, [0, 1, 2, 3, 4, 5, 6]);
  allDates.forEach((d, i) => {
    const label = `${DAY_NAMES[i]} ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
    days[label] = [];
  });

  rotas.forEach((r) => {
    const d = new Date(r.shift_date);
    const dow = d.getUTCDay();
    const idx = dow === 0 ? 6 : dow - 1;
    const label = `${DAY_NAMES[idx]} ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
    if (days[label] !== undefined) days[label].push(r);
  });

  return sendSuccess(res, 'Weekly rota view fetched successfully', {
    week_start: start,
    week_end: end,
    shop_id: shop_id || 'all',
    days,
  });
});

const clearWeek = asyncHandler(async (req, res) => {
  const { shop_id, week_start } = req.query;
  if (!week_start) {
    throw new AppError('week_start is required', 400);
  }

  const scope = buildRotaManageScope(req.user);
  const { start, end } = weekBounds(week_start);
  const filter = { shift_date: { $gte: start, $lte: end } };
  applyManageScopeFilter(filter, scope);
  if (shop_id) {
    assertManageShopAllowed(scope, shop_id);
    filter.shop_id = shop_id;
  }

  const { deletedCount } = await Rota.deleteMany(filter);
  return sendSuccess(res, `Cleared ${deletedCount} rota entries for the week`, {
    week_start: start.toISOString().slice(0, 10),
    deleted: deletedCount,
  });
});

const getDashboard = asyncHandler(async (req, res) => {
  const { week_start, shop_id, user_id } = req.query;
  if (!week_start) {
    throw new AppError('week_start is required', 400);
  }

  const scope = buildRotaReadScope(req.user);
  const { start, end } = weekBounds(week_start);
  const filter = { shift_date: { $gte: start, $lte: end } };
  applyScopeFilter(filter, req, scope);

  if (shop_id) {
    if (scope.mode === 'shops' && !scope.shopScope.all && !isShopAllowed(scope.shopScope, shop_id)) {
      return sendSuccess(res, 'Rota dashboard fetched successfully', {
        week_start: start,
        week_end: end,
        total_shifts: 0,
        by_shop: [],
        by_employee: [],
      });
    }
    filter.shop_id = shop_id;
  }
  if (user_id && scope.mode !== 'self') {
    filter.user_id = normalizeId(user_id);
  }

  const rotas = await Rota.find(filter)
    .populate('user_id', 'name email')
    .populate('shop_id', 'name')
    .sort({ shift_start: 1 });

  const shopMap = {};
  const allDates = buildDates(week_start, [0, 1, 2, 3, 4, 5, 6]);

  rotas.forEach((r) => {
    const sid = r.shop_id._id.toString();
    if (!shopMap[sid]) {
      shopMap[sid] = {
        shop: { _id: r.shop_id._id, name: r.shop_id.name },
        days: {},
      };
      allDates.forEach((d, i) => {
        const label = `${DAY_NAMES[i]} ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
        shopMap[sid].days[label] = [];
      });
    }

    const d = new Date(r.shift_date);
    const dow = d.getUTCDay();
    const idx = dow === 0 ? 6 : dow - 1;
    const label = `${DAY_NAMES[idx]} ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
    if (shopMap[sid].days[label] !== undefined) {
      shopMap[sid].days[label].push({
        rota_id: r._id,
        user: r.user_id,
        start_time: r.start_time,
        end_time: r.end_time,
        note: r.note,
      });
    }
  });

  const empMap = {};
  rotas.forEach((r) => {
    const uid = r.user_id._id.toString();
    if (!empMap[uid]) {
      empMap[uid] = {
        user: { _id: r.user_id._id, name: r.user_id.name, email: r.user_id.email },
        shifts: [],
      };
    }
    empMap[uid].shifts.push({
      rota_id: r._id,
      date: r.shift_date,
      shop: { _id: r.shop_id._id, name: r.shop_id.name },
      start_time: r.start_time,
      end_time: r.end_time,
      note: r.note,
    });
  });

  return sendSuccess(res, 'Rota dashboard fetched successfully', {
    week_start: start,
    week_end: end,
    total_shifts: rotas.length,
    by_shop: Object.values(shopMap),
    by_employee: Object.values(empMap),
  });
});

module.exports = {
  getRotas, getRota, createRota, updateRota, deleteRota,
  bulkCreate, getWeekView, clearWeek, getDashboard,
};
