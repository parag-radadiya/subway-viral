/**
 * Permission middleware factory.
 * Usage: requirePermission('can_create_users')
 * Reads the permissions object from the user's role (populated by authMiddleware).
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    const role = req.user && req.user.role_id;
    if (!role || !role.permissions || !role.permissions[permission]) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: requires '${permission}' permission`,
      });
    }
    next();
  };
};

module.exports = { requirePermission };
