const InventoryItem = require('../models/InventoryItem');
const InventoryQuery = require('../models/InventoryQuery');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { buildShopScope, isShopAllowed } = require('../middleware/shopScopeMiddleware');
const { recordInventoryAudit } = require('../utils/inventoryAudit');

function buildInventoryScope(user) {
  const permissions = user?.role_id?.permissions || {};
  if (permissions.can_manage_shops || permissions.can_manage_roles) {
    return { all: true, ids: [] };
  }
  return buildShopScope(user);
}

function applyInventoryScopeFilter(filter, scope) {
  if (scope.all) return;
  if (!scope.ids.length) {
    filter.shop_id = { $in: [] };
    return;
  }
  filter.shop_id = { $in: scope.ids };
}

function assertInventoryShopAllowed(scope, shopId) {
  if (scope.all) return;
  if (!isShopAllowed(scope, shopId)) {
    throw new AppError('Forbidden: shop is outside your assigned scope', 403);
  }
}

function buildPagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const sortOrder = String(query.sort_order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const allowedSortBy = new Set([
    'createdAt',
    'updatedAt',
    'item_name',
    'status',
    'purchase_date',
    'expiry_date',
  ]);
  const sortBy = allowedSortBy.has(query.sort_by) ? query.sort_by : 'createdAt';
  return { page, limit, sort: { [sortBy]: sortOrder } };
}

// GET /api/inventory/items
const getItems = asyncHandler(async (req, res) => {
  const scope = buildInventoryScope(req.user);
  const filter = {};
  applyInventoryScopeFilter(filter, scope);

  if (req.query.shop_id) filter.shop_id = req.query.shop_id;
  if (req.query.shop_id && !scope.all && !isShopAllowed(scope, req.query.shop_id)) {
    const { page, limit } = buildPagination(req.query);
    return sendSuccess(res, 'Inventory items fetched successfully', {
      count: 0,
      total: 0,
      page,
      limit,
      total_pages: 0,
      items: [],
    });
  }
  if (req.query.status) filter.status = req.query.status;

  const { page, limit, sort } = buildPagination(req.query);
  const skip = (page - 1) * limit;

  const [total, items] = await Promise.all([
    InventoryItem.countDocuments(filter),
    InventoryItem.find(filter)
      .populate('shop_id', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit),
  ]);

  return sendSuccess(res, 'Inventory items fetched successfully', {
    count: items.length,
    total,
    page,
    limit,
    total_pages: total ? Math.ceil(total / limit) : 0,
    items,
  });
});

// GET /api/inventory/items/:id
const getItem = asyncHandler(async (req, res) => {
  const scope = buildInventoryScope(req.user);
  const filter = { _id: req.params.id };
  applyInventoryScopeFilter(filter, scope);

  const item = await InventoryItem.findOne(filter).populate('shop_id', 'name');
  if (!item) throw new AppError('Item not found', 404);
  return sendSuccess(res, 'Inventory item fetched successfully', { item });
});

// POST /api/inventory/items
const createItem = asyncHandler(async (req, res) => {
  const scope = buildInventoryScope(req.user);
  assertInventoryShopAllowed(scope, req.body.shop_id);

  const item = await InventoryItem.create(req.body);

  await recordInventoryAudit({
    action: 'ITEM_CREATED',
    performedBy: req.user._id,
    shopId: item.shop_id,
    itemId: item._id,
    beforeState: null,
    afterState: item,
  });

  return sendSuccess(res, 'Inventory item created successfully', { item }, 201);
});

// PUT /api/inventory/items/:id
const updateItem = asyncHandler(async (req, res) => {
  const scope = buildInventoryScope(req.user);
  const existing = await InventoryItem.findById(req.params.id);
  if (!existing) throw new AppError('Item not found', 404);
  assertInventoryShopAllowed(scope, existing.shop_id);
  if (req.body.shop_id) assertInventoryShopAllowed(scope, req.body.shop_id);

  const beforeState = existing.toObject();

  const item = await InventoryItem.findByIdAndUpdate(req.params.id, req.body, {
    new: true, runValidators: true,
  });
  if (!item) throw new AppError('Item not found', 404);

  await recordInventoryAudit({
    action: 'ITEM_UPDATED',
    performedBy: req.user._id,
    shopId: item.shop_id,
    itemId: item._id,
    beforeState,
    afterState: item,
  });

  return sendSuccess(res, 'Inventory item updated successfully', { item });
});

// DELETE /api/inventory/items/:id
const deleteItem = asyncHandler(async (req, res) => {
  const scope = buildInventoryScope(req.user);
  const existing = await InventoryItem.findById(req.params.id);
  if (!existing) throw new AppError('Item not found', 404);
  assertInventoryShopAllowed(scope, existing.shop_id);

  const linkedQueryCount = await InventoryQuery.countDocuments({ item_id: existing._id });
  if (linkedQueryCount > 0) {
    throw new AppError('Cannot delete item with linked inventory queries', 409);
  }

  const beforeState = existing.toObject();
  const item = await InventoryItem.findByIdAndDelete(req.params.id);
  if (!item) throw new AppError('Item not found', 404);

  await recordInventoryAudit({
    action: 'ITEM_DELETED',
    performedBy: req.user._id,
    shopId: existing.shop_id,
    itemId: existing._id,
    beforeState,
    afterState: null,
  });

  return sendSuccess(res, 'Inventory item deleted', { item });
});

module.exports = { getItems, getItem, createItem, updateItem, deleteItem };
