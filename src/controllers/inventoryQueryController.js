const InventoryQuery = require('../models/InventoryQuery');
const InventoryItem = require('../models/InventoryItem');
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

function buildPagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const sortOrder = String(query.sort_order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const allowedSortBy = new Set(['createdAt', 'updatedAt', 'status', 'resolved_at', 'repair_cost']);
  const sortBy = allowedSortBy.has(query.sort_by) ? query.sort_by : 'createdAt';
  return { page, limit, sort: { [sortBy]: sortOrder } };
}

// GET /api/inventory/queries
const getQueries = asyncHandler(async (req, res) => {
  const scope = buildInventoryScope(req.user);
  const filter = {};
  applyScopeFilter(filter, scope);

  if (req.query.shop_id) {
    if (!scope.all && !isShopAllowed(scope, req.query.shop_id)) {
      const { page, limit } = buildPagination(req.query);
      return sendSuccess(res, 'Inventory queries fetched successfully', {
        count: 0,
        total: 0,
        page,
        limit,
        total_pages: 0,
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
      const { page, limit } = buildPagination(req.query);
      return sendSuccess(res, 'Inventory queries fetched successfully', {
        count: 0,
        total: 0,
        page,
        limit,
        total_pages: 0,
        queries: [],
      });
    }
    filter.item_id = req.query.item_id;
  }

  const { page, limit, sort } = buildPagination(req.query);
  const skip = (page - 1) * limit;

  const [total, queries] = await Promise.all([
    InventoryQuery.countDocuments(filter),
    InventoryQuery.find(filter)
      .populate('item_id', 'item_name status')
      .populate('shop_id', 'name')
      .populate('reported_by', 'name email')
      .populate('resolved_by', 'name email')
      .sort(sort)
      .skip(skip)
      .limit(limit),
  ]);

  return sendSuccess(res, 'Inventory queries fetched successfully', {
    count: queries.length,
    total,
    page,
    limit,
    total_pages: total ? Math.ceil(total / limit) : 0,
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

      const existingOpenQuery = await InventoryQuery.findOne({ item_id, status: 'Open' }).select('_id');
      if (existingOpenQuery) {
        throw new AppError('An open inventory query already exists for this item', 409);
      }

      // ── Auto-sync: set item status to 'Damaged' ──
  item.status = 'Damaged';
  await item.save();

      let query;
      try {
        query = await InventoryQuery.create({
          item_id,
          shop_id: effectiveShopId,
          reported_by: req.user._id,
          issue_note,
          status: 'Open',
        });
      } catch (err) {
        if (err?.code === 11000) {
          throw new AppError('An open inventory query already exists for this item', 409);
        }
        throw err;
      }

          await recordInventoryAudit({
            action: 'QUERY_OPENED',
            performedBy: req.user._id,
            shopId: effectiveShopId,
            itemId: item._id,
            queryId: query._id,
            beforeState: null,
            afterState: query,
          });

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

  const existing = await InventoryQuery.findById(req.params.id);
  if (!existing) throw new AppError('Query not found', 404);
  assertShopAllowed(scope, existing.shop_id);

  const beforeState = existing.toObject();

  const query = await InventoryQuery.findOneAndUpdate(
    { _id: req.params.id, status: 'Open' },
    {
      $set: {
        status: 'Closed',
        repair_cost: repair_cost ?? null,
        resolve_note: resolve_note ?? null,
        resolved_by: req.user._id,
        resolved_at: new Date(),
      },
    },
    { new: true, runValidators: true }
  );

  if (!query) {
    throw new AppError('Query is already closed', 409);
  }

      // Keep item Damaged while any open query remains for this item.
      const remainingOpenCount = await InventoryQuery.countDocuments({
        item_id: query.item_id,
        status: 'Open',
      });
      const nextItemStatus = remainingOpenCount > 0 ? 'Damaged' : 'Good';
      await InventoryItem.findByIdAndUpdate(query.item_id, { status: nextItemStatus });

          await recordInventoryAudit({
            action: 'QUERY_CLOSED',
            performedBy: req.user._id,
            shopId: query.shop_id,
            itemId: query.item_id,
            queryId: query._id,
            beforeState,
            afterState: query,
            metadata: { item_status_after_close: nextItemStatus, remaining_open_queries: remainingOpenCount },
          });

  const populated = await query.populate([
    { path: 'item_id', select: 'item_name status' },
    { path: 'resolved_by', select: 'name email' },
  ]);

  return sendSuccess(res, `Query closed and item status set to ${nextItemStatus}`, {
    query: populated,
  });
});

module.exports = { getQueries, getQuery, createQuery, closeQuery };
