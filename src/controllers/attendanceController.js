const jwt = require('jsonwebtoken');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { isShopAllowed } = require('../middleware/shopScopeMiddleware');

const canAccessShop = (req, shopId) => {
  return isShopAllowed(req.shopScope, shopId);
};

// ─────────────────────────────────────────────
// STEP 1: Verify GPS location → return a short-lived location_token
// POST /api/attendance/verify-location
// geoMiddleware runs BEFORE this — if we reach here, GPS passed
// ─────────────────────────────────────────────
const verifyLocation = async (req, res) => {
  try {
    const { shop_id } = req.body;

    if (!canAccessShop(req, shop_id)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: you can only punch in at your assigned shops',
      });
    }

    // Issue a location_token (5-min TTL)
    const locationToken = jwt.sign(
      { userId: req.user._id, shopId: shop_id },
      process.env.LOCATION_TOKEN_SECRET,
      { expiresIn: `${process.env.LOCATION_TOKEN_TTL_MINUTES}m` }
    );

    res.json({
      success: true,
      message: 'Location verified. Proceed with biometric confirmation.',
      location_token: locationToken,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────
// STEP 2+3: Biometric result + location_token → Punch-In
// POST /api/attendance/punch-in
// ─────────────────────────────────────────────
const punchIn = async (req, res) => {
  try {
    const { shop_id, location_token, biometric_verified } = req.body;
    const deviceId = req.headers['x-device-id'];

    if (!canAccessShop(req, shop_id)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: you can only punch in at your assigned shops',
      });
    }

    // 1. Biometric must be confirmed by frontend
    if (!biometric_verified) {
      return res.status(403).json({ success: false, message: 'Biometric confirmation failed' });
    }

    // 2. Verify location_token
    let decoded;
    try {
      decoded = jwt.verify(location_token, process.env.LOCATION_TOKEN_SECRET);
    } catch {
      return res.status(403).json({ success: false, message: 'Location token is invalid or expired. Please re-verify your location.' });
    }

    // 3. Token must match the requesting user and shop
    if (decoded.userId.toString() !== req.user._id.toString() || decoded.shopId !== shop_id) {
      return res.status(403).json({ success: false, message: 'Location token mismatch' });
    }

    // 4. Device ID check
    if (!deviceId || deviceId !== req.user.device_id) {
      return res.status(403).json({ success: false, message: 'Device not recognised. Registered device ID mismatch.' });
    }

    // 5. Check no open punch-in already exists
    const existing = await Attendance.findOne({ user_id: req.user._id, punch_out: null });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Already punched in. Please punch out first.' });
    }

    const attendance = await Attendance.create({
      user_id: req.user._id,
      shop_id,
      punch_in: new Date(),
      is_manual: false,
      punch_method: 'GPS+Biometric',
    });

    res.status(201).json({ success: true, data: attendance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────
// Punch-Out
// PUT /api/attendance/:id/punch-out
// ─────────────────────────────────────────────
const punchOut = async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);

    if (!attendance) {
      return res.status(404).json({ success: false, message: 'Attendance record not found' });
    }
    if (attendance.user_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorised to punch out this record' });
    }
    if (attendance.punch_out) {
      return res.status(400).json({ success: false, message: 'Already punched out' });
    }

    attendance.punch_out = new Date();
    await attendance.save();

    res.json({ success: true, data: attendance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────
// Manual Punch-In — Sub-Manager exception flow
// POST /api/attendance/manual-punch-in
// Requires: can_manual_punch permission (checked in route via permMiddleware)
// ─────────────────────────────────────────────
const manualPunchIn = async (req, res) => {
  try {
    const { user_id, shop_id } = req.body;

    if (!user_id || !shop_id) {
      return res.status(400).json({ success: false, message: 'user_id and shop_id are required' });
    }

    if (!canAccessShop(req, shop_id)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: you can only manual-punch for your assigned shops',
      });
    }

    const staffUser = await User.findById(user_id);
    if (!staffUser || !staffUser.is_active) {
      return res.status(404).json({ success: false, message: 'Staff member not found' });
    }

    // Check no open punch-in already exists
    const existing = await Attendance.findOne({ user_id, punch_out: null });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Staff member is already punched in' });
    }

    const attendance = await Attendance.create({
      user_id,
      shop_id,
      punch_in: new Date(),
      is_manual: true,
      manual_by: req.user._id,
      punch_method: 'Manual',
    });

    const populated = await attendance.populate([
      { path: 'user_id', select: 'name email' },
      { path: 'manual_by', select: 'name email' },
    ]);

    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────
// GET all attendance records (admin/manager view)
// GET /api/attendance
// ─────────────────────────────────────────────
const getAttendance = async (req, res) => {
  try {
    const filter = {};
    if (req.query.user_id) filter.user_id = req.query.user_id;
    if (req.query.shop_id) filter.shop_id = req.query.shop_id;

    const records = await Attendance.find(filter)
      .populate('user_id', 'name email')
      .populate('shop_id', 'name')
      .populate('manual_by', 'name email')
      .sort({ punch_in: -1 });

    res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { verifyLocation, punchIn, punchOut, manualPunchIn, getAttendance };
