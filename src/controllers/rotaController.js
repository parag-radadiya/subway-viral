const Rota = require('../models/Rota');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');

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

function weekBounds(weekStart) {
  const dates = buildDates(weekStart, [0, 1, 2, 3, 4, 5, 6]);
  const start = new Date(dates[0]);
  const end = new Date(dates[6]);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const getRotas = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.shop_id) filter.shop_id = req.query.shop_id;
  if (req.query.user_id) filter.user_id = req.query.user_id;
  if (req.query.date) filter.shift_date = new Date(req.query.date);

  const rotas = await Rota.find(filter)
    .populate('user_id', 'name email')
    .populate('shop_id', 'name')
    .sort({ shift_date: 1, start_time: 1 });

  return sendSuccess(res, 'Rota list fetched successfully', {
    count: rotas.length,
    rotas,
  });
});

const getRota = asyncHandler(async (req, res) => {
  const rota = await Rota.findById(req.params.id)
    .populate('user_id', 'name email')
    .populate('shop_id', 'name');

  if (!rota) throw new AppError('Rota not found', 404);
  return sendSuccess(res, 'Rota fetched successfully', { rota });
});

const createRota = asyncHandler(async (req, res) => {
  try {
    const rota = await Rota.create(req.body);
    const populated = await rota.populate([
      { path: 'user_id', select: 'name email' },
      { path: 'shop_id', select: 'name' },
    ]);
    return sendSuccess(res, 'Rota created successfully', { rota: populated }, 201);
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError('A rota entry for this user/date/start_time already exists', 409);
    }
    throw err;
  }
});

const updateRota = asyncHandler(async (req, res) => {
  try {
    const rota = await Rota.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    })
      .populate('user_id', 'name email')
      .populate('shop_id', 'name');

    if (!rota) throw new AppError('Rota not found', 404);
    return sendSuccess(res, 'Rota updated successfully', { rota });
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError('Conflict: a rota with that user/date/start_time already exists', 409);
    }
    throw err;
  }
});

const deleteRota = asyncHandler(async (req, res) => {
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

  const dates = buildDates(week_start, days);
  const { start: weekStart, end: weekEnd } = weekBounds(week_start);
  const userIds = [...new Set(assignments.map((a) => a.user_id))];

  if (replace_existing) {
    await Rota.deleteMany({
      user_id: { $in: userIds },
      shift_date: { $gte: weekStart, $lte: weekEnd },
    });
  }

  const toInsert = [];
  for (const date of dates) {
    for (const assignment of assignments) {
      toInsert.push({
        user_id: assignment.user_id,
        shop_id,
        shift_date: date,
        start_time: assignment.start_time,
        end_time: assignment.end_time || undefined,
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

  const { start, end } = weekBounds(week_start);
  const filter = { shift_date: { $gte: start, $lte: end } };
  if (shop_id) filter.shop_id = shop_id;

  const rotas = await Rota.find(filter)
    .populate('user_id', 'name email phone_num')
    .populate('shop_id', 'name')
    .sort({ shift_date: 1, start_time: 1 });

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

  const { start, end } = weekBounds(week_start);
  const filter = { shift_date: { $gte: start, $lte: end } };
  if (shop_id) filter.shop_id = shop_id;

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

  const { start, end } = weekBounds(week_start);
  const filter = { shift_date: { $gte: start, $lte: end } };
  if (shop_id) filter.shop_id = shop_id;
  if (user_id) filter.user_id = user_id;

  const rotas = await Rota.find(filter)
    .populate('user_id', 'name email')
    .populate('shop_id', 'name')
    .sort({ shift_date: 1, start_time: 1 });

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
