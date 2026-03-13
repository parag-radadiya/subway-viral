const User = require('../models/User');
const Shop = require('../models/Shop');

const normalizeAssignedShopIds = (assignedShopIds, shopId) => {
  const ids = Array.isArray(assignedShopIds)
    ? assignedShopIds.map((id) => id && id.toString()).filter(Boolean)
    : [];
  const primary = shopId ? shopId.toString() : null;
  if (primary && !ids.includes(primary)) ids.push(primary);
  return ids;
};

const buildUserShopScopeFilter = (shopScope) => {
  if (shopScope?.all) return {};
  if (!shopScope?.ids?.length) return { _id: { $exists: false } };
  return {
    $or: [
      { shop_id: { $in: shopScope.ids } },
      { assigned_shop_ids: { $in: shopScope.ids } },
    ],
  };
};

const isUserInShopScope = (shopScope, user) => {
  if (shopScope?.all) return true;
  const primary = user?.shop_id ? user.shop_id.toString() : null;
  const assigned = Array.isArray(user?.assigned_shop_ids)
    ? user.assigned_shop_ids.map((id) => id.toString())
    : [];
  return Boolean(
    (primary && shopScope?.ids?.includes(primary))
      || assigned.some((id) => shopScope?.ids?.includes(id))
  );
};

// @route  GET /api/users/assigned-shops/staff-summary
// @access Sub-Manager+ (requires can_manual_punch)
const getAssignedShopStaffSummary = async (req, res) => {
  try {
    const { shop_id } = req.query;
    const canReadAll = req.shopScope?.all;

    if (!canReadAll && shop_id && !req.shopScope?.ids?.includes(shop_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: shop is outside your assigned scope' });
    }

    const scopeShopIds = canReadAll
      ? (shop_id ? [shop_id] : null)
      : (shop_id ? [shop_id] : req.shopScope?.ids || []);

    if (!scopeShopIds || scopeShopIds.length === 0) {
      return res.json({
        success: true,
        scope: { all: canReadAll, shop_ids: [] },
        totals: { shops: 0, users: 0 },
        by_shop: [],
      });
    }

    const shops = await Shop.find({ _id: { $in: scopeShopIds } }).select('name');
    const users = await User.find({
      is_active: true,
      $or: [
        { shop_id: { $in: scopeShopIds } },
        { assigned_shop_ids: { $in: scopeShopIds } },
      ],
    })
      .populate('role_id', 'role_name permissions')
      .populate('shop_id', 'name')
      .populate('assigned_shop_ids', 'name');

    const userRows = users.map((u) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      role_name: u.role_id?.role_name || null,
      shop_id: u.shop_id?._id || u.shop_id || null,
      assigned_shop_ids: (u.assigned_shop_ids || []).map((s) => s._id || s),
    }));

    const byShop = shops.map((shop) => {
      const sid = shop._id.toString();
      const shopUsers = userRows.filter((u) => {
        const primary = u.shop_id && u.shop_id.toString();
        const assigned = (u.assigned_shop_ids || []).map((id) => id.toString());
        return primary === sid || assigned.includes(sid);
      });

      return {
        shop: { _id: shop._id, name: shop.name },
        user_count: shopUsers.length,
        users: shopUsers,
      };
    });

    return res.json({
      success: true,
      scope: { all: canReadAll, shop_ids: scopeShopIds },
      totals: { shops: shops.length, users: userRows.length },
      by_shop: byShop,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const isRequestedShopSetAllowed = (shopScope, shopIds) => {
  if (shopScope?.all) return true;
  if (!Array.isArray(shopIds) || !shopIds.length) return false;
  return shopIds.every((id) => shopScope?.ids?.includes(id.toString()));
};

// @route  GET /api/users/me
// @access Self (JWT required)
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('role_id', 'role_name permissions')
      .populate('shop_id', 'name')
      .populate('assigned_shop_ids', 'name');

    if (!user || !user.is_active) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  GET /api/users
// @access Admin/Manager
const getUsers = async (req, res) => {
  try {
    const users = await User.find({
      is_active: true,
      ...buildUserShopScopeFilter(req.shopScope),
    })
      .populate('role_id', 'role_name permissions')
      .populate('shop_id', 'name')
      .populate('assigned_shop_ids', 'name');
    res.json({ success: true, count: users.length, data: users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  GET /api/users/:id
// @access Admin/Manager
const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('role_id', 'role_name permissions')
      .populate('shop_id', 'name')
      .populate('assigned_shop_ids', 'name');
    if (!user || !user.is_active) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (!isUserInShopScope(req.shopScope, user)) {
      return res.status(403).json({ success: false, message: 'Forbidden: user is outside your assigned shops' });
    }
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  POST /api/users
// @access Admin only (requires can_create_users permission)
const createUser = async (req, res) => {
  try {
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
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }

    const normalizedAssignedShopIds = normalizeAssignedShopIds(assigned_shop_ids, shop_id);
    const primaryShopId = shop_id || normalizedAssignedShopIds[0] || null;

    if (!isRequestedShopSetAllowed(req.shopScope, normalizedAssignedShopIds)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: you can only create users within your assigned shops',
      });
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
      shop_id: primaryShopId,
      assigned_shop_ids: normalizedAssignedShopIds,
      must_change_password: true,
    });

    const populated = await user.populate([
      { path: 'role_id', select: 'role_name permissions' },
      { path: 'shop_id', select: 'name' },
      { path: 'assigned_shop_ids', select: 'name' },
    ]);
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  PUT /api/users/:id
// @access Admin
const updateUser = async (req, res) => {
  try {
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
    const shouldUpdateShops = shop_id !== undefined || assigned_shop_ids !== undefined;
    const existingUser = await User.findById(req.params.id).select('shop_id assigned_shop_ids');
    if (!existingUser) return res.status(404).json({ success: false, message: 'User not found' });
    if (!isUserInShopScope(req.shopScope, existingUser)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: user is outside your assigned shops',
      });
    }

    const normalizedAssignedShopIds = shouldUpdateShops
      ? normalizeAssignedShopIds(assigned_shop_ids, shop_id)
      : undefined;
    const primaryShopId = shouldUpdateShops
      ? (shop_id || normalizedAssignedShopIds[0] || null)
      : undefined;

    const updateData = {
      name,
      email,
      phone_code,
      phone_num,
      role_id,
      device_id,
    };
    if (shouldUpdateShops) {
      if (!isRequestedShopSetAllowed(req.shopScope, normalizedAssignedShopIds)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: you can only assign users to your allowed shops',
        });
      }
      updateData.shop_id = primaryShopId;
      updateData.assigned_shop_ids = normalizedAssignedShopIds;
    }
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) delete updateData[key];
    });

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('role_id', 'role_name permissions')
      .populate('shop_id', 'name')
      .populate('assigned_shop_ids', 'name');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  DELETE /api/users/:id — soft delete
// @access Admin
const deleteUser = async (req, res) => {
  try {
    const existingUser = await User.findById(req.params.id).select('shop_id assigned_shop_ids');
    if (!existingUser) return res.status(404).json({ success: false, message: 'User not found' });
    if (!isUserInShopScope(req.shopScope, existingUser)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: user is outside your assigned shops',
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { is_active: false },
      { new: true }
    );
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, message: 'User deactivated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  PUT /api/users/me/password
// @access Self (JWT required)
const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both currentPassword and newPassword are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
    }

    const user = await User.findById(req.user._id).select('+password_hash');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const match = await user.matchPassword(currentPassword);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    user.password_hash = newPassword; // bcrypt pre-save hook re-hashes
    user.must_change_password = false;
    await user.save();

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getMe,
  getAssignedShopStaffSummary,
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  updatePassword,
};
