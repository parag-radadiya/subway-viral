const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { reconcileUserOverdueAutoPunchOuts } = require('../utils/attendanceReconcile');

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

const refreshTtlDays = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30);

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generateRefreshToken(userId) {
  const entropy = crypto.randomBytes(48).toString('hex');
  return `${userId}.${entropy}`;
}

async function issueAuthTokens(userDoc) {
  const accessToken = generateToken(userDoc._id);
  const refreshToken = generateRefreshToken(userDoc._id);
  const expiresAt = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);

  userDoc.refresh_token_hash = hashRefreshToken(refreshToken);
  userDoc.refresh_token_expires_at = expiresAt;
  await userDoc.save({ validateBeforeSave: false });

  return { accessToken, refreshToken, refreshTokenExpiresAt: expiresAt };
}

function buildLoginPayload(user, tokens) {
  return {
    token: tokens.accessToken,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    refresh_token_expires_at: tokens.refreshTokenExpiresAt,
    must_change_password: user.must_change_password,
    needs_device_registration: !user.device_id,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role_id,
      active_shop_id: user.active_shop_id || user.shop_id || null,
      shop_id: user.shop_id,
      assigned_shop_ids: user.assigned_shop_ids || [],
    },
  };
}

// @route  POST /api/auth/login
// @access Public
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  const user = await User.findOne({ email }).select('+password_hash').populate('role_id');

  if (!user || !(await user.matchPassword(password))) {
    throw new AppError('Invalid credentials', 400);
  }

  if (!user.is_active) {
    throw new AppError('User not found or deactivated', 400);
  }

  await reconcileUserOverdueAutoPunchOuts(user._id, { limit: 200 });
  const tokens = await issueAuthTokens(user);

  return sendSuccess(res, 'Login successful', buildLoginPayload(user, tokens));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    throw new AppError('refresh_token is required', 400);
  }

  const [userId] = String(refresh_token).split('.');
  if (!userId) {
    throw new AppError('Invalid refresh_token format', 401);
  }

  const user = await User.findById(userId)
    .select('+refresh_token_hash +refresh_token_expires_at')
    .populate('role_id');

  if (!user || !user.is_active) {
    throw new AppError('Invalid refresh token', 401);
  }

  const tokenHash = hashRefreshToken(refresh_token);
  if (!user.refresh_token_hash || user.refresh_token_hash !== tokenHash) {
    throw new AppError('Invalid refresh token', 401);
  }

  if (!user.refresh_token_expires_at || user.refresh_token_expires_at <= new Date()) {
    throw new AppError('Refresh token expired. Please login again.', 401);
  }

  await reconcileUserOverdueAutoPunchOuts(user._id, { limit: 200 });
  const tokens = await issueAuthTokens(user);

  return sendSuccess(res, 'Access token refreshed successfully', buildLoginPayload(user, tokens));
});

const logout = asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    throw new AppError('refresh_token is required', 400);
  }

  const [userId] = String(refresh_token).split('.');
  if (!userId) {
    throw new AppError('Invalid refresh_token format', 400);
  }

  const user = await User.findById(userId).select('+refresh_token_hash +refresh_token_expires_at');
  if (!user) {
    return sendSuccess(res, 'Logged out successfully', {});
  }

  const tokenHash = hashRefreshToken(refresh_token);
  if (user.refresh_token_hash && user.refresh_token_hash === tokenHash) {
    await reconcileUserOverdueAutoPunchOuts(user._id, { limit: 200 });
    user.refresh_token_hash = null;
    user.refresh_token_expires_at = null;
    await user.save({ validateBeforeSave: false });
  }

  return sendSuccess(res, 'Logged out successfully', {});
});

module.exports = { login, refreshAccessToken, logout };
