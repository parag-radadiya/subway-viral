const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');

// Generate JWT
const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

// @route  POST /api/auth/login
// @access Public
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  const user = await User.findOne({ email })
    .select('+password_hash')
    .populate('role_id');

  if (!user || !(await user.matchPassword(password))) {
    throw new AppError('Invalid credentials', 400);
  }

  if (!user.is_active) {
    throw new AppError('User not found or deactivated', 400);
  }

  return sendSuccess(res, 'Login successful', {
    token: generateToken(user._id),
    must_change_password: user.must_change_password,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role_id,
      shop_id: user.shop_id,
    },
  });
});

module.exports = { login };
