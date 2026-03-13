const Rota = require('../models/Rota');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Given a week_start (any date) and a days array (0=Mon … 6=Sun),
 * return an array of Date objects for those weekdays.
 */
function buildDates(weekStart, days) {
  // Normalise to midnight UTC of the given Monday
  const base = new Date(weekStart);
  base.setUTCHours(0, 0, 0, 0);
  // Adjust so base is always Monday of that iso-week
  const dayOfWeek = base.getUTCDay(); // 0=Sun,1=Mon…
  const offsetToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  base.setUTCDate(base.getUTCDate() + offsetToMon);

  return days.map((d) => {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + d); // 0=Mon, 6=Sun
    return date;
  });
}

/**
 * Return start (Mon) and end (Sun) of the ISO week containing `weekStart`.
 */
function weekBounds(weekStart) {
  const dates = buildDates(weekStart, [0, 1, 2, 3, 4, 5, 6]);
  const start = new Date(dates[0]);
  const end = new Date(dates[6]);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Read access: staff can read their own rota, privileged roles can read all.
const canReadAllRotas = (req) => {
  const permissions = req.user?.role_id?.permissions || {};
  return Boolean(permissions.can_view_all_staff || permissions.can_manage_rotas);
};

const canReadShop = (req, shopId) => {
  if (req.shopScope?.all) return true;
  return Boolean(shopId && req.shopScope?.ids?.includes(shopId.toString()));
};

// ─── Existing single-record endpoints (unchanged) ────────────────────────────

// GET /api/rotas
const getRotas = async (req, res) => {
  try {
    const filter = {};
    if (req.query.shop_id) filter.shop_id = req.query.shop_id;
    if (req.query.user_id) filter.user_id = req.query.user_id;
    if (req.query.date) filter.shift_date = new Date(req.query.date);

    if (!canReadAllRotas(req)) {
      filter.user_id = req.user._id;
    } else if (!req.shopScope?.all) {
      if (req.query.shop_id && !canReadShop(req, req.query.shop_id)) {
        return res.status(403).json({ success: false, message: 'Forbidden: shop is outside your assigned scope' });
      }
      filter.shop_id = req.query.shop_id || { $in: req.shopScope?.ids || [] };
    }

    const rotas = await Rota.find(filter)
      .populate('user_id', 'name email')
      .populate('shop_id', 'name')
      .sort({ shift_date: 1, start_time: 1 });
    res.json({ success: true, count: rotas.length, data: rotas });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/rotas/:id
const getRota = async (req, res) => {
  try {
    const rota = await Rota.findById(req.params.id)
      .populate('user_id', 'name email')
      .populate('shop_id', 'name');
    if (!rota) return res.status(404).json({ success: false, message: 'Rota not found' });

    if (!canReadAllRotas(req) && rota.user_id?._id?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Forbidden: you can only access your own rota records' });
    }
    if (canReadAllRotas(req) && !canReadShop(req, rota.shop_id?._id || rota.shop_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: rota is outside your assigned shops' });
    }

    res.json({ success: true, data: rota });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/rotas  (single record — kept for manual overrides)
const createRota = async (req, res) => {
  try {
    const rota = await Rota.create(req.body);
    const populated = await rota.populate([
      { path: 'user_id', select: 'name email' },
      { path: 'shop_id', select: 'name' },
    ]);
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A rota entry for this user/date/start_time already exists',
      });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/rotas/:id
const updateRota = async (req, res) => {
  try {
    const rota = await Rota.findByIdAndUpdate(req.params.id, req.body, {
      new: true, runValidators: true,
    })
      .populate('user_id', 'name email')
      .populate('shop_id', 'name');
    if (!rota) return res.status(404).json({ success: false, message: 'Rota not found' });
    res.json({ success: true, data: rota });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Conflict: a rota with that user/date/start_time already exists',
      });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/rotas/:id
const deleteRota = async (req, res) => {
  try {
    const rota = await Rota.findByIdAndDelete(req.params.id);
    if (!rota) return res.status(404).json({ success: false, message: 'Rota not found' });
    res.json({ success: true, message: 'Rota deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Bulk / Weekly endpoints ──────────────────────────────────────────────────

/**
 * POST /api/rotas/bulk
 *
 * Body:
 * {
 *   shop_id: "<id>",
 *   week_start: "2026-03-16",          // any date — system snaps to Mon
 *   days: [0,1,2,3,4],                 // 0=Mon … 6=Sun
 *   assignments: [
 *     { user_id, start_time, end_time?, note? },
 *     { user_id, start_time, end_time?, note? }   // second shift same user OK
 *   ],
 *   replace_existing: false            // if true: wipe user's full week first
 * }
 *
 * Response: { created, skipped, conflicts[] }
 */
const bulkCreate = async (req, res) => {
  try {
    const { shop_id, week_start, days, assignments, replace_existing = false } = req.body;

    if (!shop_id || !week_start || !Array.isArray(days) || !Array.isArray(assignments)) {
      return res.status(400).json({
        success: false,
        message: 'shop_id, week_start, days[], and assignments[] are all required',
      });
    }
    if (days.some((d) => d < 0 || d > 6)) {
      return res.status(400).json({ success: false, message: 'days values must be 0 (Mon) – 6 (Sun)' });
    }

    const dates = buildDates(week_start, days);
    const { start: weekStart, end: weekEnd } = weekBounds(week_start);
    const userIds = [...new Set(assignments.map((a) => a.user_id))];

    // Optional: wipe existing week rotas for these users before re-inserting
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

    // insertMany with ordered:false — continues on duplicate key errors
    let created = 0;
    const conflicts = [];

    const result = await Rota.insertMany(toInsert, { ordered: false }).catch((err) => {
      if (err.name === 'MongoBulkWriteError' || err.code === 11000) {
        // Partial success — some inserted, some dupes
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

    res.status(201).json({
      success: true,
      created,
      skipped: conflicts.length,
      conflicts,
      message: `${created} rota entries created, ${conflicts.length} skipped (duplicates)`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/rotas/week?shop_id=<id>&week_start=YYYY-MM-DD
 *
 * Returns a calendar grid for the week grouped by day.
 * days: { "Mon 16 Mar": [...], "Tue 17 Mar": [...], ... }
 */
const getWeekView = async (req, res) => {
  try {
    const { shop_id, week_start } = req.query;
    if (!week_start) {
      return res.status(400).json({ success: false, message: 'week_start is required (YYYY-MM-DD)' });
    }

    const { start, end } = weekBounds(week_start);
    const filter = { shift_date: { $gte: start, $lte: end } };
    if (shop_id) filter.shop_id = shop_id;
    if (!canReadAllRotas(req)) {
      filter.user_id = req.user._id;
    } else if (!req.shopScope?.all) {
      if (shop_id && !canReadShop(req, shop_id)) {
        return res.status(403).json({ success: false, message: 'Forbidden: shop is outside your assigned scope' });
      }
      filter.shop_id = shop_id || { $in: req.shopScope?.ids || [] };
    }

    const rotas = await Rota.find(filter)
      .populate('user_id', 'name email phone_num')
      .populate('shop_id', 'name')
      .sort({ shift_date: 1, start_time: 1 });

    // Group by day label
    const days = {};
    const allDates = buildDates(week_start, [0, 1, 2, 3, 4, 5, 6]);
    allDates.forEach((d, i) => {
      const label = `${DAY_NAMES[i]} ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
      days[label] = [];
    });

    rotas.forEach((r) => {
      const d = new Date(r.shift_date);
      const dow = d.getUTCDay(); // 0=Sun
      // Convert JS Sunday=0 → our Mon=0 convention
      const idx = dow === 0 ? 6 : dow - 1;
      const label = `${DAY_NAMES[idx]} ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
      if (days[label] !== undefined) days[label].push(r);
    });

    res.json({
      success: true,
      week_start: start,
      week_end: end,
      shop_id: shop_id || 'all',
      days,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/rotas/week?shop_id=<id>&week_start=YYYY-MM-DD
 *
 * Clears all rotas for a shop (or all shops) for the given ISO week.
 * Use before re-publishing a week's rota.
 */
const clearWeek = async (req, res) => {
  try {
    const { shop_id, week_start } = req.query;
    if (!week_start) {
      return res.status(400).json({ success: false, message: 'week_start is required' });
    }

    const { start, end } = weekBounds(week_start);
    const filter = { shift_date: { $gte: start, $lte: end } };
    if (shop_id) filter.shop_id = shop_id;

    const { deletedCount } = await Rota.deleteMany(filter);
    res.json({
      success: true,
      deleted: deletedCount,
      message: `Cleared ${deletedCount} rota entries for the week of ${start.toISOString().slice(0, 10)}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/rotas/dashboard?week_start=YYYY-MM-DD[&shop_id=][&user_id=]
 *
 * Returns:
 *   by_shop   — for each shop, a Mon-Sun day grid of all shifts
 *   by_employee — for each employee, all their shifts that week
 */
const getDashboard = async (req, res) => {
  try {
    const { week_start, shop_id, user_id } = req.query;
    if (!week_start) {
      return res.status(400).json({ success: false, message: 'week_start is required' });
    }

    const { start, end } = weekBounds(week_start);
    const filter = { shift_date: { $gte: start, $lte: end } };
    if (shop_id) filter.shop_id = shop_id;
    if (user_id) filter.user_id = user_id;

    if (!req.shopScope?.all) {
      if (shop_id && !canReadShop(req, shop_id)) {
        return res.status(403).json({ success: false, message: 'Forbidden: shop is outside your assigned scope' });
      }
      filter.shop_id = shop_id || { $in: req.shopScope?.ids || [] };
    }

    const rotas = await Rota.find(filter)
      .populate('user_id', 'name email')
      .populate('shop_id', 'name')
      .sort({ shift_date: 1, start_time: 1 });

    // ── by_shop ──────────────────────────────────────────────────────────────
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

    // ── by_employee ───────────────────────────────────────────────────────────
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

    res.json({
      success: true,
      week_start: start,
      week_end: end,
      total_shifts: rotas.length,
      by_shop: Object.values(shopMap),
      by_employee: Object.values(empMap),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getRotas, getRota, createRota, updateRota, deleteRota,
  bulkCreate, getWeekView, clearWeek, getDashboard,
};
