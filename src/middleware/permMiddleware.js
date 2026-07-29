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

const requireRoot = () => {
  return (req, res, next) => {
    const roleName = req.user?.role_id?.role_name;
    if (roleName !== 'Root') {
      return next(new AppError('Forbidden: root access required', 403));
    }
    next();
  };
};

/**
 * Restrict a route to one or more named roles.
 * Usage: requireRoles(['Root', 'Admin'])
 * Reads role_name from the user's populated role (set by authMiddleware).
 */
const requireRoles = (allowedRoles) => {
  const allowed = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req, res, next) => {
    const roleName = req.user?.role_id?.role_name;
    if (!roleName || !allowed.includes(roleName)) {
      return next(new AppError(`Forbidden: requires one of roles [${allowed.join(', ')}]`, 403));
    }
    next();
  };
};

module.exports = { requirePermission, requireRoot, requireRoles };
