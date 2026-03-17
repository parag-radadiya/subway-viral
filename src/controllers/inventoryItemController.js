const InventoryItem = require('../models/InventoryItem');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { buildShopScope, isShopAllowed } = require('../middleware/shopScopeMiddleware');

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

// GET /api/inventory/items
const getItems = asyncHandler(async (req, res) => {
  const scope = buildInventoryScope(req.user);
  const filter = {};
  applyInventoryScopeFilter(filter, scope);

  if (req.query.shop_id) filter.shop_id = req.query.shop_id;
  if (req.query.shop_id && !scope.all && !isShopAllowed(scope, req.query.shop_id)) {
    return sendSuccess(res, 'Inventory items fetched successfully', {
      count: 0,
      items: [],
    });
  }
  if (req.query.status) filter.status = req.query.status;

  const items = await InventoryItem.find(filter).populate('shop_id', 'name');
  return sendSuccess(res, 'Inventory items fetched successfully', {
    count: items.length,
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
  return sendSuccess(res, 'Inventory item created successfully', { item }, 201);
});

// PUT /api/inventory/items/:id
const updateItem = asyncHandler(async (req, res) => {
  const scope = buildInventoryScope(req.user);
  const existing = await InventoryItem.findById(req.params.id);
  if (!existing) throw new AppError('Item not found', 404);
  assertInventoryShopAllowed(scope, existing.shop_id);
  if (req.body.shop_id) assertInventoryShopAllowed(scope, req.body.shop_id);

  const item = await InventoryItem.findByIdAndUpdate(req.params.id, req.body, {
    new: true, runValidators: true,
  });
  if (!item) throw new AppError('Item not found', 404);
  return sendSuccess(res, 'Inventory item updated successfully', { item });
});

// DELETE /api/inventory/items/:id
const deleteItem = asyncHandler(async (req, res) => {
  const scope = buildInventoryScope(req.user);
  const existing = await InventoryItem.findById(req.params.id);
  if (!existing) throw new AppError('Item not found', 404);
  assertInventoryShopAllowed(scope, existing.shop_id);

  const item = await InventoryItem.findByIdAndDelete(req.params.id);
  if (!item) throw new AppError('Item not found', 404);
  return sendSuccess(res, 'Inventory item deleted', { item });
});

module.exports = { getItems, getItem, createItem, updateItem, deleteItem };
