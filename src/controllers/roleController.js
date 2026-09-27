const Role = require('../models/Role');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { parsePagination, toPageMeta } = require('../utils/pagination');
const {
  isOrgWideActor,
  isProtectedRoleName,
  assertPermissionsWithinActor,
} = require('../utils/roleGuards');

// Scoped role managers (e.g. Manager with can_manage_roles) cannot touch
// Admin/Root roles or their own role, and cannot grant permissions they lack.
// Org-wide actors (Admin/Root) are unrestricted, as before.
const assertScopedRoleWrite = (req, { existingRole, nextName, nextPermissions }) => {
  if (isOrgWideActor(req.user)) return;

  if (existingRole) {
    if (isProtectedRoleName(existingRole.role_name)) {
      throw new AppError('Forbidden: not allowed to modify this role', 403);
    }
    if (existingRole._id.toString() === req.user.role_id?._id?.toString()) {
      throw new AppError('Forbidden: you cannot modify your own role', 403);
    }
  }
  if (nextName !== undefined && isProtectedRoleName(nextName)) {
    throw new AppError('Forbidden: role name is reserved', 403);
  }
  assertPermissionsWithinActor(req.user, nextPermissions);
};

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
  assertScopedRoleWrite(req, {
    nextName: req.body.role_name,
    nextPermissions: req.body.permissions,
  });
  const role = await Role.create(req.body);
  return sendSuccess(res, 'Role created successfully', { role }, 201);
});

// PUT /api/roles/:id
const updateRole = asyncHandler(async (req, res) => {
  if (!isOrgWideActor(req.user)) {
    const existingRole = await Role.findById(req.params.id);
    if (!existingRole) throw new AppError('Role not found', 404);
    assertScopedRoleWrite(req, {
      existingRole,
      nextName: req.body.role_name,
      nextPermissions: req.body.permissions,
    });
  }
  const role = await Role.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!role) throw new AppError('Role not found', 404);
  return sendSuccess(res, 'Role updated successfully', { role });
});

// DELETE /api/roles/:id
const deleteRole = asyncHandler(async (req, res) => {
  if (!isOrgWideActor(req.user)) {
    const existingRole = await Role.findById(req.params.id);
    if (!existingRole) throw new AppError('Role not found', 404);
    assertScopedRoleWrite(req, { existingRole });
    if (await User.exists({ role_id: existingRole._id, is_active: true })) {
      throw new AppError('Forbidden: role is still assigned to active users', 403);
    }
  }
  const role = await Role.findByIdAndDelete(req.params.id);
  if (!role) throw new AppError('Role not found', 404);
  return sendSuccess(res, 'Role deleted', { role });
});

module.exports = { getRoles, getRole, createRole, updateRole, deleteRole };
