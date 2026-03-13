const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { buildShopScope } = require('./shopScopeMiddleware');

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id)
      .select('-password_hash')
      .populate('role_id');

    if (!req.user || !req.user.is_active) {
      return res.status(401).json({ success: false, message: 'User not found or deactivated' });
    }

    req.shopScope = buildShopScope(req.user);

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};

module.exports = { protect };
