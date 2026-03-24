const jwt = require('jsonwebtoken');
const Attendance = require('../models/Attendance');
const Rota = require('../models/Rota');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const {
  reconcileOverdueAutoPunchOuts,
  reconcileUserOverdueAutoPunchOuts,
} = require('../utils/attendanceReconcile');
const { isShopAllowed, buildReadScope } = require('../middleware/shopScopeMiddleware');

const PRE_SHIFT_GRACE_HOURS = 1;
const AUTO_PUNCH_OUT_AFTER_SHIFT_HOURS = 2;

function addHours(dateValue, hours) {
  const date = new Date(dateValue);
  date.setTime(date.getTime() + hours * 60 * 60 * 1000);
  return date;
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
  const existing = await Attendance.findOne({ user_id: req.user._id, punch_out: null });
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
  const existing = await Attendance.findOne({ user_id, punch_out: null });
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
  const scope = buildReadScope(req.user);
  const filter = {};

  if (scope.mode === 'self') {
    filter.user_id = req.user._id;
  } else if (scope.mode === 'shops') {
    if (!scope.shopScope.all && scope.shopScope.ids.length === 0) {
      return sendSuccess(res, 'Attendance records fetched successfully', {
        count: 0,
        records: [],
      });
    }
    if (!scope.shopScope.all) {
      filter.shop_id = { $in: scope.shopScope.ids };
    }
  }

  if (req.query.user_id && scope.mode !== 'self') filter.user_id = req.query.user_id;
  if (req.query.shop_id) {
    if (
      scope.mode === 'shops' &&
      !scope.shopScope.all &&
      !isShopAllowed(scope.shopScope, req.query.shop_id)
    ) {
      return sendSuccess(res, 'Attendance records fetched successfully', {
        count: 0,
        records: [],
      });
    }
    filter.shop_id = req.query.shop_id;
  }

  const records = await Attendance.find(filter)
    .populate('user_id', 'name email')
    .populate('shop_id', 'name')
    .populate('rota_id', 'shift_start shift_end shift_date start_time end_time note')
    .populate('manual_by', 'name email')
    .sort({ punch_in: -1 });

  return sendSuccess(res, 'Attendance records fetched successfully', {
    count: records.length,
    records,
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

module.exports = {
  verifyLocation,
  punchIn,
  punchOut,
  manualPunchIn,
  getAttendance,
  getEligibleRotas,
  reconcileAllOverdue,
  reconcileSelfOverdue,
};
