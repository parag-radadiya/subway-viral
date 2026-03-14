const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('Not authorized, no token', 401));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id)
      .select('-password_hash')
      .populate('role_id');

    if (!req.user || !req.user.is_active) {
      return next(new AppError('User not found or deactivated', 401));
    }

    next();
  } catch (err) {
    return next(new AppError('Token invalid or expired', 401));
  }
};

module.exports = { protect };
