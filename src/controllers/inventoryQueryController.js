const InventoryQuery = require('../models/InventoryQuery');
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

function applyScopeFilter(filter, scope) {
  if (scope.all) return;
  if (!scope.ids.length) {
    filter.shop_id = { $in: [] };
    return;
  }
  filter.shop_id = { $in: scope.ids };
}

function assertShopAllowed(scope, shopId) {
  if (scope.all) return;
  if (!isShopAllowed(scope, shopId)) {
    throw new AppError('Forbidden: shop is outside your assigned scope', 403);
  }
}

// GET /api/inventory/queries
const getQueries = asyncHandler(async (req, res) => {
  const scope = buildInventoryScope(req.user);
  const filter = {};
  applyScopeFilter(filter, scope);

  if (req.query.shop_id) {
    if (!scope.all && !isShopAllowed(scope, req.query.shop_id)) {
      return sendSuccess(res, 'Inventory queries fetched successfully', {
        count: 0,
        queries: [],
      });
    }
    filter.shop_id = req.query.shop_id;
  }
  if (req.query.status) filter.status = req.query.status;
  if (req.query.item_id) {
    const itemFilter = { _id: req.query.item_id };
    applyScopeFilter(itemFilter, scope);
    const scopedItem = await InventoryItem.findOne(itemFilter).select('_id');
    if (!scopedItem) {
      return sendSuccess(res, 'Inventory queries fetched successfully', {
        count: 0,
        queries: [],
      });
    }
    filter.item_id = req.query.item_id;
  }

  const queries = await InventoryQuery.find(filter)
    .populate('item_id', 'item_name status')
    .populate('shop_id', 'name')
    .populate('reported_by', 'name email')
    .populate('resolved_by', 'name email')
    .sort({ createdAt: -1 });

  return sendSuccess(res, 'Inventory queries fetched successfully', {
    count: queries.length,
    queries,
  });
});

// GET /api/inventory/queries/:id
const getQuery = asyncHandler(async (req, res) => {
  const scope = buildInventoryScope(req.user);
  const filter = { _id: req.params.id };
  applyScopeFilter(filter, scope);

  const query = await InventoryQuery.findOne(filter)
    .populate('item_id', 'item_name status')
    .populate('shop_id', 'name')
    .populate('reported_by', 'name email')
    .populate('resolved_by', 'name email');

  if (!query) throw new AppError('Query not found', 404);
  return sendSuccess(res, 'Inventory query fetched successfully', { query });
});

// POST /api/inventory/queries
// Creates the query ticket + auto-sets item status to 'Damaged'
const createQuery = asyncHandler(async (req, res) => {
  const { item_id, shop_id, issue_note } = req.body;
  const scope = buildInventoryScope(req.user);

    // Verify item exists
  const item = await InventoryItem.findById(item_id);
  if (!item) throw new AppError('Inventory item not found', 404);
  assertShopAllowed(scope, item.shop_id);

  if (shop_id && item.shop_id.toString() !== shop_id.toString()) {
    throw new AppError('shop_id must match the item shop', 400);
  }

    // Create the query (ticket)
  const effectiveShopId = shop_id || item.shop_id;
  assertShopAllowed(scope, effectiveShopId);
  const query = await InventoryQuery.create({
    item_id,
    shop_id: effectiveShopId,
    reported_by: req.user._id,
    issue_note,
    status: 'Open',
  });

    // ── Auto-sync: set item status to 'Damaged' ──
  item.status = 'Damaged';
  await item.save();

  const populated = await query.populate([
    { path: 'item_id', select: 'item_name status' },
    { path: 'shop_id', select: 'name' },
    { path: 'reported_by', select: 'name email' },
  ]);

  return sendSuccess(res, 'Query opened and item marked as Damaged', {
    query: populated,
  }, 201);
});

// PUT /api/inventory/queries/:id/close
// Closes the query + auto-reverts item status to 'Good'
const closeQuery = asyncHandler(async (req, res) => {
  const { repair_cost, resolve_note } = req.body;
  const scope = buildInventoryScope(req.user);

  const query = await InventoryQuery.findById(req.params.id);
  if (!query) throw new AppError('Query not found', 404);
  assertShopAllowed(scope, query.shop_id);

  if (query.status === 'Closed') {
    throw new AppError('Query is already closed', 400);
  }

    // Update the query
  query.status = 'Closed';
  query.repair_cost = repair_cost ?? null;
  query.resolve_note = resolve_note ?? null;
  query.resolved_by = req.user._id;
  query.resolved_at = new Date();
  await query.save();

    // ── Auto-sync: revert item status to 'Good' ──
  await InventoryItem.findByIdAndUpdate(query.item_id, { status: 'Good' });

  const populated = await query.populate([
    { path: 'item_id', select: 'item_name status' },
    { path: 'resolved_by', select: 'name email' },
  ]);

  return sendSuccess(res, 'Query closed and item status reverted to Good', {
    query: populated,
  });
});

module.exports = { getQueries, getQuery, createQuery, closeQuery };
