const AppError = require('./AppError');
const { buildShopScope, isShopAllowed } = require('../middleware/shopScopeMiddleware');

// Roles that only org-wide actors (Admin/Root) may create, assign, edit or delete.
const PROTECTED_ROLE_NAMES = ['root', 'admin'];

// Roles a scoped actor (e.g. Manager) can see in the roles list and assign to users.
const SCOPED_ASSIGNABLE_ROLE_NAMES = ['staff', 'sub-manager', 'manager'];

// Roles a scoped actor sees in the users list: only the roles below Manager.
const SCOPED_LISTABLE_USER_ROLE_NAMES = ['staff', 'sub-manager'];

const normalizeRoleName = (roleName) =>
  String(roleName || '')
    .trim()
    .toLowerCase();

// Case-insensitive exact-match query for role_name against a list of names.
const roleNameQuery = (names) => ({
  role_name: { $in: names.map((name) => new RegExp(`^${name}$`, 'i')) },
});

const toId = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const isProtectedRoleName = (roleName) =>
  PROTECTED_ROLE_NAMES.includes(normalizeRoleName(roleName));

const isScopedAssignableRoleName = (roleName) =>
  SCOPED_ASSIGNABLE_ROLE_NAMES.includes(normalizeRoleName(roleName));

// Org-wide actors (can_manage_shops: Admin/Root) keep their existing, unrestricted
// behaviour. Everyone else — e.g. a Manager granted can_create_users or
// can_manage_roles — goes through the scoped guards below.
const isOrgWideActor = (user) => Boolean(user?.role_id?.permissions?.can_manage_shops);

// Every shop the target user will belong to must be inside the actor's shops.
const assertShopsWithinActorScope = (actor, shopIds) => {
  const ids = [...new Set((shopIds || []).map(toId).filter(Boolean))];
  if (ids.length === 0) {
    throw new AppError('Forbidden: user must be assigned to at least one of your shops', 403);
  }
  const shopScope = buildShopScope(actor);
  if (ids.some((id) => !isShopAllowed(shopScope, id))) {
    throw new AppError('Forbidden: shop is outside your assigned scope', 403);
  }
};

const assertAssignableRole = (role) => {
  if (!role) throw new AppError('Role not found', 400);
  if (!isScopedAssignableRoleName(role.role_name)) {
    throw new AppError('Forbidden: not allowed to assign this role', 403);
  }
};

// A scoped actor may only grant permissions they already hold, so role edits
// can never escalate beyond the actor's own access.
const assertPermissionsWithinActor = (actor, permissions) => {
  if (permissions === undefined || permissions === null) return;
  if (typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw new AppError('permissions must be an object', 400);
  }
  const own = actor?.role_id?.permissions || {};
  const escalated = Object.keys(permissions).filter((key) => permissions[key] && !own[key]);
  if (escalated.length > 0) {
    throw new AppError(
      `Forbidden: cannot grant permissions you do not have (${escalated.join(', ')})`,
      403
    );
  }
};

module.exports = {
  SCOPED_ASSIGNABLE_ROLE_NAMES,
  SCOPED_LISTABLE_USER_ROLE_NAMES,
  roleNameQuery,
  isProtectedRoleName,
  isScopedAssignableRoleName,
  isOrgWideActor,
  assertShopsWithinActorScope,
  assertAssignableRole,
  assertPermissionsWithinActor,
};
