const InventoryAuditLog = require('../models/InventoryAuditLog');
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

function buildPagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const sortOrder = String(query.sort_order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const allowedSortBy = new Set(['createdAt', 'action']);
  const sortBy = allowedSortBy.has(query.sort_by) ? query.sort_by : 'createdAt';
  return { page, limit, sort: { [sortBy]: sortOrder } };
}

const getAuditLogs = asyncHandler(async (req, res) => {
  const scope = buildInventoryScope(req.user);
  const filter = {};
  applyScopeFilter(filter, scope);

  if (req.query.shop_id) {
    if (!scope.all && !isShopAllowed(scope, req.query.shop_id)) {
      return sendSuccess(res, 'Inventory audit logs fetched successfully', {
        count: 0,
        total: 0,
        page: 1,
        limit: 20,
        total_pages: 0,
        logs: [],
      });
    }
    filter.shop_id = req.query.shop_id;
  }
  if (req.query.item_id) filter.item_id = req.query.item_id;
  if (req.query.query_id) filter.query_id = req.query.query_id;
  if (req.query.action) filter.action = req.query.action;

  const { page, limit, sort } = buildPagination(req.query);
  const skip = (page - 1) * limit;

  const [total, logs] = await Promise.all([
    InventoryAuditLog.countDocuments(filter),
    InventoryAuditLog.find(filter)
      .populate('performed_by', 'name email')
      .populate('shop_id', 'name')
      .populate('item_id', 'item_name status')
      .populate('query_id', 'status')
      .sort(sort)
      .skip(skip)
      .limit(limit),
  ]);

  return sendSuccess(res, 'Inventory audit logs fetched successfully', {
    count: logs.length,
    total,
    page,
    limit,
    total_pages: total ? Math.ceil(total / limit) : 0,
    logs,
  });
});

module.exports = { getAuditLogs };
