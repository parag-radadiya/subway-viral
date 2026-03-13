const Role = require('../models/Role');

// GET /api/roles
const getRoles = async (req, res) => {
  try {
    const roles = await Role.find();
    res.json({ success: true, data: roles });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/roles/:id
const getRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
    res.json({ success: true, data: role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/roles
const createRole = async (req, res) => {
  try {
    const role = await Role.create(req.body);
    res.status(201).json({ success: true, data: role });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/roles/:id
const updateRole = async (req, res) => {
  try {
    const role = await Role.findByIdAndUpdate(req.params.id, req.body, {
      new: true, runValidators: true,
    });
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
    res.json({ success: true, data: role });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/roles/:id
const deleteRole = async (req, res) => {
  try {
    const role = await Role.findByIdAndDelete(req.params.id);
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
    res.json({ success: true, message: 'Role deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getRoles, getRole, createRole, updateRole, deleteRole };
