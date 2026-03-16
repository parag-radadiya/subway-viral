const User = require('../models/User');
const Shop = require('../models/Shop');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { buildShopScope } = require('../middleware/shopScopeMiddleware');

// @route  GET /api/users
// @access Admin/Manager
const getUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ is_active: true })
    .populate('role_id', 'role_name permissions')
    .populate('shop_id', 'name');
  return sendSuccess(res, 'Users fetched successfully', {
    count: users.length,
    users,
  });
});

// @route  GET /api/users/:id
// @access Admin/Manager
const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .populate('role_id', 'role_name permissions')
    .populate('shop_id', 'name');

  if (!user || !user.is_active) {
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
    assigned_shop_ids,
  } = req.body;

  const existing = await User.findOne({ email });
  if (existing) {
    throw new AppError('Email already in use', 400);
  }

    // password_hash field triggers the pre-save bcrypt hook
  const user = await User.create({
    name,
    email,
    phone_code,
    phone_num,
    password_hash: password,
    role_id,
    device_id,
    shop_id,
    assigned_shop_ids,
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
    phone_code,
    phone_num,
    role_id,
    device_id,
    shop_id,
    assigned_shop_ids,
  } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    {
      name,
      email,
      phone_code,
      phone_num,
      role_id,
      device_id,
      shop_id,
      assigned_shop_ids,
    },
    { new: true, runValidators: true }
  ).populate('role_id', 'role_name');

  if (!user) throw new AppError('User not found', 404);
  return sendSuccess(res, 'User updated successfully', { user });
});

// @route  DELETE /api/users/:id — soft delete
// @access Admin
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { is_active: false },
    { new: true }
  );
  if (!user) throw new AppError('User not found', 404);
  return sendSuccess(res, 'User deactivated successfully', { user });
});

// @route  PUT /api/users/me/password
// @access Self (JWT required)
const updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new AppError('Both currentPassword and newPassword are required', 400);
  }
  if (newPassword.length < 8) {
    throw new AppError('New password must be at least 8 characters', 400);
  }

  const user = await User.findById(req.user._id).select('+password_hash');
  if (!user) throw new AppError('User not found', 404);

  const match = await user.matchPassword(currentPassword);
  if (!match) {
    throw new AppError('Current password is incorrect', 401);
  }

  user.password_hash = newPassword; // bcrypt pre-save hook re-hashes
  user.must_change_password = false;
  await user.save();

  return sendSuccess(res, 'Password updated successfully', {});
});

// @route GET /api/users/assigned-shops/staff-summary
// @access Manager/Sub-Manager/Admin/Root scoped by assigned shops
const getAssignedShopsStaffSummary = asyncHandler(async (req, res) => {
  const permissions = req.user?.role_id?.permissions || {};
  const canAccessSummary = Boolean(
    permissions.can_view_all_staff || permissions.can_manage_inventory || permissions.can_manual_punch
  );
  if (!canAccessSummary) {
    throw new AppError('Forbidden: not allowed to view staff summary', 403);
  }

  const shopScope = buildShopScope(req.user);
  if (!shopScope.all && shopScope.ids.length === 0) {
    return sendSuccess(res, 'Assigned-shops staff summary fetched successfully', {
      count: 0,
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

  return sendSuccess(res, 'Assigned-shops staff summary fetched successfully', {
    count: Object.values(byShop).length,
    shops: Object.values(byShop),
  });
});

module.exports = {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  updatePassword,
  getAssignedShopsStaffSummary,
};
