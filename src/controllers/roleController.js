const Role = require('../models/Role');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { parsePagination, toPageMeta } = require('../utils/pagination');

// GET /api/roles
const getRoles = asyncHandler(async (req, res) => {
  const { page, limit, skip, sort } = parsePagination(req.query, {
    defaultSortBy: 'createdAt',
    allowedSortBy: ['createdAt', 'updatedAt', 'role_name'],
  });

  const [total, roles] = await Promise.all([
    Role.countDocuments({}),
    Role.find({}).sort(sort).skip(skip).limit(limit),
  ]);

  return sendSuccess(res, 'Roles fetched successfully', {
    ...toPageMeta(total, page, limit, roles.length),
    roles,
  });
});

// GET /api/roles/:id
const getRole = asyncHandler(async (req, res) => {
  const role = await Role.findById(req.params.id);
  if (!role) throw new AppError('Role not found', 404);
  return sendSuccess(res, 'Role fetched successfully', { role });
});

// POST /api/roles
const createRole = asyncHandler(async (req, res) => {
  const role = await Role.create(req.body);
  return sendSuccess(res, 'Role created successfully', { role }, 201);
});

// PUT /api/roles/:id
const updateRole = asyncHandler(async (req, res) => {
  const role = await Role.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!role) throw new AppError('Role not found', 404);
  return sendSuccess(res, 'Role updated successfully', { role });
});

// DELETE /api/roles/:id
const deleteRole = asyncHandler(async (req, res) => {
  const role = await Role.findByIdAndDelete(req.params.id);
  if (!role) throw new AppError('Role not found', 404);
  return sendSuccess(res, 'Role deleted', { role });
});

module.exports = { getRoles, getRole, createRole, updateRole, deleteRole };
