const unique = (ids) => [...new Set(ids)];

const toId = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const resolveAllowedShopIds = (user) => {
  const assigned = Array.isArray(user?.assigned_shop_ids)
    ? user.assigned_shop_ids.map(toId).filter(Boolean)
    : [];
  const primary = toId(user?.active_shop_id) || toId(user?.shop_id);
  return unique(primary ? [...assigned, primary] : assigned);
};

const canAccessAllShops = (user) => {
  const permissions = user?.role_id?.permissions || {};
  return Boolean(permissions.can_manage_shops || permissions.can_manage_roles);
};

const buildShopScope = (user) => ({
  all: canAccessAllShops(user),
  ids: resolveAllowedShopIds(user),
});

const isShopAllowed = (shopScope, shopId) => {
  if (!shopId) return false;
  if (shopScope?.all) return true;
  const id = toId(shopId);
  return Boolean(id && shopScope?.ids?.includes(id));
};

const buildReadScope = (user) => {
  const permissions = user?.role_id?.permissions || {};
  if (permissions.can_manage_shops || permissions.can_manage_roles) {
    return { mode: 'all', shopScope: { all: true, ids: [] } };
  }
  if (permissions.can_view_all_staff || permissions.can_manage_inventory || permissions.can_manual_punch) {
    return { mode: 'shops', shopScope: buildShopScope(user) };
  }
  return { mode: 'self', shopScope: { all: false, ids: [] } };
};

module.exports = {
  resolveAllowedShopIds,
  canAccessAllShops,
  buildShopScope,
  isShopAllowed,
  buildReadScope,
};
