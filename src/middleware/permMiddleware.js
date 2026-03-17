/**
 * Permission middleware factory.
 * Usage: requirePermission('can_create_users')
 * Reads the permissions object from the user's role (populated by authMiddleware).
 */
const AppError = require('../utils/AppError');

const requirePermission = (permission) => {
  return (req, res, next) => {
    const role = req.user && req.user.role_id;
    if (!role || !role.permissions || !role.permissions[permission]) {
      return next(new AppError(`Forbidden: requires '${permission}' permission`, 403));
    }
    next();
  };
};

module.exports = { requirePermission };
