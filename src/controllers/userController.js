const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');

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
  const { name, email, phone_code, phone_num, password, role_id, device_id, shop_id } = req.body;

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
    must_change_password: true,
  });

  const populated = await user.populate('role_id', 'role_name');
  return sendSuccess(res, 'User created successfully', { user: populated }, 201);
});

// @route  PUT /api/users/:id
// @access Admin
const updateUser = asyncHandler(async (req, res) => {
  const { name, email, phone_code, phone_num, role_id, device_id, shop_id } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { name, email, phone_code, phone_num, role_id, device_id, shop_id },
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

module.exports = { getUsers, getUser, createUser, updateUser, deleteUser, updatePassword };
