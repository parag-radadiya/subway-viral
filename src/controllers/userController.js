const User = require('../models/User');
const Shop = require('../models/Shop');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { parsePagination, toPageMeta } = require('../utils/pagination');
const {
  buildShopScope,
  isShopAllowed,
  buildReadScope,
} = require('../middleware/shopScopeMiddleware');

const toId = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const uniqueIds = (ids) => [...new Set(ids.filter(Boolean))];

const resolveShopState = ({ shop_id, active_shop_id, assigned_shop_ids }) => {
  const assigned = Array.isArray(assigned_shop_ids) ? assigned_shop_ids.map(toId) : [];
  const active = toId(active_shop_id) || toId(shop_id) || assigned[0] || null;
  const finalAssigned = uniqueIds(active ? [...assigned, active] : assigned);
  return {
    shop_id: active,
    active_shop_id: active,
    assigned_shop_ids: finalAssigned,
  };
};

const applyUserReadScopeFilter = (filter, req, scope) => {
  if (scope.mode === 'all') return;

  if (scope.mode === 'self') {
    filter._id = req.user._id;
    return;
  }

  if (!scope.shopScope.all && scope.shopScope.ids.length === 0) {
    filter.shop_id = { $in: [] };
    return;
  }

  if (!scope.shopScope.all) {
    filter.shop_id = { $in: scope.shopScope.ids };
  }
};

const isUserReadableInScope = (scope, user) => {
  if (scope.mode === 'all') return true;
  if (scope.mode === 'self') return false;
  if (scope.shopScope.all) return true;
  return isShopAllowed(scope.shopScope, user.active_shop_id || user.shop_id);
};

// @route  GET /api/users
// @access Scoped by role (all/assigned shops/self)
const getUsers = asyncHandler(async (req, res) => {
  const scope = buildReadScope(req.user);
  const filter = { is_active: true };
  const { page, limit, skip, sort } = parsePagination(req.query, {
    defaultSortBy: 'createdAt',
    allowedSortBy: ['createdAt', 'updatedAt', 'name', 'email'],
  });
  applyUserReadScopeFilter(filter, req, scope);

  if (req.query.shop_id) {
    if (
      scope.mode === 'shops' &&
      !scope.shopScope.all &&
      !isShopAllowed(scope.shopScope, req.query.shop_id)
    ) {
      return sendSuccess(res, 'Users fetched successfully', {
        count: 0,
        users: [],
      });
    }
    if (scope.mode === 'self') {
      const selfShopScope = buildShopScope(req.user);
      if (!isShopAllowed(selfShopScope, req.query.shop_id)) {
        return sendSuccess(res, 'Users fetched successfully', {
          count: 0,
          users: [],
        });
      }
    }
    filter.shop_id = req.query.shop_id;
  }

  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .populate('role_id', 'role_name permissions')
      .populate('shop_id', 'name')
      .populate('active_shop_id', 'name')
      .populate('shop_history.shop_id', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit),
  ]);

  return sendSuccess(res, 'Users fetched successfully', {
    ...toPageMeta(total, page, limit, users.length),
    users,
  });
});

// @route  GET /api/users/:id
// @access Scoped by role (all/assigned shops/self)
const getUser = asyncHandler(async (req, res) => {
  const scope = buildReadScope(req.user);

  if (scope.mode === 'self' && req.params.id.toString() !== req.user._id.toString()) {
    throw new AppError('User not found', 404);
  }

  const user = await User.findById(req.params.id)
    .populate('role_id', 'role_name permissions')
    .populate('shop_id', 'name')
    .populate('active_shop_id', 'name')
    .populate('shop_history.shop_id', 'name');

  if (!user || !user.is_active) {
    throw new AppError('User not found', 404);
  }

  if (!isUserReadableInScope(scope, user) && user._id.toString() !== req.user._id.toString()) {
    throw new AppError('User not found', 404);
  }

  return sendSuccess(res, 'User fetched successfully', { user });
});

// @route  POST /api/users
// @access Admin only (requires can_create_users permission)
const createUser = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    phone_code,
    phone_num,
    password,
    role_id,
    device_id,
    shop_id,
    active_shop_id,
    assigned_shop_ids,
  } = req.body;

  const existing = await User.findOne({ email });
  if (existing) {
    throw new AppError('Email already in use', 400);
  }

  const shopState = resolveShopState({
    shop_id,
    active_shop_id,
    assigned_shop_ids,
  });

  // password_hash field triggers the pre-save bcrypt hook
  const user = await User.create({
    name,
    email,
    phone_code,
    phone_num,
    password_hash: password,
    role_id,
    device_id,
    shop_id: shopState.shop_id,
    active_shop_id: shopState.active_shop_id,
    assigned_shop_ids: shopState.assigned_shop_ids,
    must_change_password: true,
  });

  const populated = await user.populate('role_id', 'role_name');
  return sendSuccess(res, 'User created successfully', { user: populated }, 201);
});

// @route  PUT /api/users/:id
// @access Admin
const updateUser = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    password,
    phone_code,
    phone_num,
    role_id,
    device_id,
    shop_id,
    active_shop_id,
    assigned_shop_ids,
  } = req.body;

  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);

  const oldActiveShopId = toId(user.active_shop_id || user.shop_id);
  const nextShopState = resolveShopState({
    shop_id: shop_id !== undefined ? shop_id : user.shop_id,
    active_shop_id: active_shop_id !== undefined ? active_shop_id : user.active_shop_id,
    assigned_shop_ids: assigned_shop_ids !== undefined ? assigned_shop_ids : user.assigned_shop_ids,
  });

  if (name !== undefined) user.name = name;
  if (email !== undefined) user.email = email;
  if (password !== undefined) {
    if (typeof password !== 'string' || password.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400);
    }
    // Use password_hash field so User pre-save hook re-hashes securely.
    user.password_hash = password;
    user.must_change_password = true;
  }
  if (phone_code !== undefined) user.phone_code = phone_code;
  if (phone_num !== undefined) user.phone_num = phone_num;
  if (role_id !== undefined) user.role_id = role_id;
  if (device_id !== undefined) user.device_id = device_id;
  user.shop_id = nextShopState.shop_id;
  user.active_shop_id = nextShopState.active_shop_id;
  user.assigned_shop_ids = nextShopState.assigned_shop_ids;

  const newActiveShopId = toId(nextShopState.active_shop_id);
  if (oldActiveShopId && newActiveShopId && oldActiveShopId !== newActiveShopId) {
    user.shop_history = Array.isArray(user.shop_history) ? user.shop_history : [];
    user.shop_history.push({
      shop_id: oldActiveShopId,
      changed_at: new Date(),
      changed_by: req.user?._id || null,
      note: 'Active shop changed',
    });
  }

  await user.save();
  await user.populate('role_id', 'role_name');
  return sendSuccess(res, 'User updated successfully', { user });
});

// @route  DELETE /api/users/:id — soft delete
// @access Admin
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { is_active: false }, { new: true });
  if (!user) throw new AppError('User not found', 404);
  return sendSuccess(res, 'User deactivated successfully', { user });
});

// @route  PUT /api/users/me/password
// @access Self (JWT required)
const updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, device_id } = req.body;

  if (!currentPassword || !newPassword) {
    throw new AppError('Both currentPassword and newPassword are required', 400);
  }
  if (newPassword.length < 8) {
    throw new AppError('New password must be at least 8 characters', 400);
  }

  if (!device_id || typeof device_id !== 'string' || !device_id.trim()) {
    throw new AppError('device_id is required', 400);
  }

  const user = await User.findById(req.user._id).select('+password_hash');
  if (!user) throw new AppError('User not found', 404);

  const match = await user.matchPassword(currentPassword);
  if (!match) {
    throw new AppError('Current password is incorrect', 401);
  }

  user.password_hash = newPassword; // bcrypt pre-save hook re-hashes
  user.must_change_password = false;
  user.device_id = device_id.trim();
  await user.save();

  return sendSuccess(res, 'Password updated successfully', {});
});

// @route  PUT /api/users/me/device
// @access Self (JWT required)
const updateOwnDevice = asyncHandler(async (req, res) => {
  const { device_id } = req.body;
  if (!device_id || typeof device_id !== 'string' || !device_id.trim()) {
    throw new AppError('device_id is required', 400);
  }

  const user = await User.findById(req.user._id);
  if (!user) throw new AppError('User not found', 404);

  user.device_id = device_id.trim();
  await user.save();

  return sendSuccess(res, 'Device registered successfully', {
    user: {
      _id: user._id,
      device_id: user.device_id,
    },
  });
});

// @route GET /api/users/assigned-shops/staff-summary
// @access Manager/Sub-Manager/Admin/Root scoped by assigned shops
const getAssignedShopsStaffSummary = asyncHandler(async (req, res) => {
  const permissions = req.user?.role_id?.permissions || {};
  const canAccessSummary = Boolean(
    permissions.can_view_all_staff ||
    permissions.can_manage_inventory ||
    permissions.can_manual_punch
  );
  if (!canAccessSummary) {
    throw new AppError('Forbidden: not allowed to view staff summary', 403);
  }

  const shopScope = buildShopScope(req.user);
  const { page, limit } = parsePagination(req.query, {
    defaultSortBy: 'name',
    allowedSortBy: ['name'],
  });
  if (!shopScope.all && shopScope.ids.length === 0) {
    return sendSuccess(res, 'Assigned-shops staff summary fetched successfully', {
      ...toPageMeta(0, page, limit, 0),
      shops: [],
    });
  }

  const shopFilter = shopScope.all ? {} : { _id: { $in: shopScope.ids } };
  const shops = await Shop.find(shopFilter).select('name geofence_radius_m');
  const shopIds = shops.map((shop) => shop._id);

  const users = await User.find({ is_active: true, shop_id: { $in: shopIds } })
    .populate('role_id', 'role_name')
    .populate('shop_id', 'name');

  const staffUsers = users.filter((user) => user.role_id?.role_name === 'Staff');
  const byShop = {};
  shops.forEach((shop) => {
    byShop[shop._id.toString()] = {
      shop: {
        _id: shop._id,
        name: shop.name,
      },
      staff_count: 0,
      staff: [],
    };
  });

  staffUsers.forEach((user) => {
    const sid = user.shop_id?._id?.toString();
    if (!sid || !byShop[sid]) return;
    byShop[sid].staff.push({
      _id: user._id,
      name: user.name,
      email: user.email,
      phone_code: user.phone_code,
      phone_num: user.phone_num,
    });
    byShop[sid].staff_count += 1;
  });

  const allShops = Object.values(byShop);
  const start = (page - 1) * limit;
  const shopsPage = allShops.slice(start, start + limit);

  return sendSuccess(res, 'Assigned-shops staff summary fetched successfully', {
    ...toPageMeta(allShops.length, page, limit, shopsPage.length),
    shops: shopsPage,
  });
});

// @route GET /api/users/by-shop/:shopId/staff
// @access Admin/Manager/Sub-Manager scoped by shop access
const getUsersByShopExcludingRootAdmin = asyncHandler(async (req, res) => {
  const { shopId } = req.params;
  const scope = buildReadScope(req.user);
  const { page, limit, skip, sort } = parsePagination(req.query, {
    defaultSortBy: 'name',
    allowedSortBy: ['createdAt', 'updatedAt', 'name', 'email'],
  });

  if (scope.mode === 'self') {
    throw new AppError('Forbidden: not allowed to view shop users', 403);
  }

  if (scope.mode === 'shops' && !scope.shopScope.all && !isShopAllowed(scope.shopScope, shopId)) {
    throw new AppError('Forbidden: shop is outside your assigned scope', 403);
  }

  const users = await User.find({
    is_active: true,
    shop_id: shopId,
  })
    .populate('role_id', 'role_name permissions')
    .populate('shop_id', 'name')
    .sort(sort)
    .skip(skip)
    .limit(limit);

  const totalUsersInShop = await User.countDocuments({
    is_active: true,
    shop_id: shopId,
  });

  const filtered = users.filter((user) => {
    const roleName = user.role_id?.role_name;
    return roleName !== 'Root' && roleName !== 'Admin';
  });

  return sendSuccess(res, 'Shop users fetched successfully', {
    ...toPageMeta(totalUsersInShop, page, limit, filtered.length),
    users: filtered,
  });
});

module.exports = {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  updatePassword,
  updateOwnDevice,
  getAssignedShopsStaffSummary,
  getUsersByShopExcludingRootAdmin,
};
