const User = require('../models/User');

// @route  GET /api/users
// @access Admin/Manager
const getUsers = async (req, res) => {
  try {
    const users = await User.find({ is_active: true })
      .populate('role_id', 'role_name permissions')
      .populate('shop_id', 'name');
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
      .populate('shop_id', 'name');
    if (!user || !user.is_active) {
      return res.status(404).json({ success: false, message: 'User not found' });
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
    const { name, email, phone_code, phone_num, password, role_id, device_id, shop_id } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already in use' });
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
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route  PUT /api/users/:id
// @access Admin
const updateUser = async (req, res) => {
  try {
    const { name, email, phone_code, phone_num, role_id, device_id, shop_id } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, phone_code, phone_num, role_id, device_id, shop_id },
      { new: true, runValidators: true }
    ).populate('role_id', 'role_name');

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

module.exports = { getUsers, getUser, createUser, updateUser, deleteUser, updatePassword };
