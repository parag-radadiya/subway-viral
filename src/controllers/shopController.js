const Shop = require('../models/Shop');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { parsePagination, toPageMeta } = require('../utils/pagination');
const {
  buildShopScope,
  isShopAllowed,
  buildReadScope,
} = require('../middleware/shopScopeMiddleware');

const normalizeTime = (value) =>
  value === undefined || value === null ? null : String(value).trim();

const appendShopTimeHistory = (shop, { openingTime, closingTime, changedBy, note, changedAt }) => {
  const at = changedAt || new Date();
  const history = Array.isArray(shop.shop_time_history) ? shop.shop_time_history : [];

  if (history.length > 0) {
    const last = history[history.length - 1];
    if (!last.effective_to) {
      last.effective_to = at;
    }
  }

  history.push({
    opening_time: openingTime,
    closing_time: closingTime,
    effective_from: at,
    effective_to: null,
    changed_at: at,
    changed_by: changedBy || null,
    note: note || null,
  });

  shop.shop_time_history = history;
};

// GET /api/shops
const getShops = asyncHandler(async (req, res) => {
  const scope = buildReadScope(req.user);
  const { page, limit, skip, sort } = parsePagination(req.query, {
    defaultSortBy: 'createdAt',
    allowedSortBy: ['createdAt', 'updatedAt', 'name'],
  });

  if (scope.mode === 'all') {
    const [total, shops] = await Promise.all([
      Shop.countDocuments({}),
      Shop.find({}).sort(sort).skip(skip).limit(limit),
    ]);
    return sendSuccess(res, 'Shops fetched successfully', {
      ...toPageMeta(total, page, limit, shops.length),
      shops,
    });
  }

  const shopScope = buildShopScope(req.user);
  if (!shopScope.all && shopScope.ids.length === 0) {
    return sendSuccess(res, 'Shops fetched successfully', {
      ...toPageMeta(0, page, limit, 0),
      shops: [],
    });
  }

  const filter = shopScope.all ? {} : { _id: { $in: shopScope.ids } };
  const [total, shops] = await Promise.all([
    Shop.countDocuments(filter),
    Shop.find(filter).sort(sort).skip(skip).limit(limit),
  ]);
  return sendSuccess(res, 'Shops fetched successfully', {
    ...toPageMeta(total, page, limit, shops.length),
    shops,
  });
});

// GET /api/shops/:id
const getShop = asyncHandler(async (req, res) => {
  const scope = buildReadScope(req.user);

  if (scope.mode !== 'all') {
    const shopScope = buildShopScope(req.user);
    if (!isShopAllowed(shopScope, req.params.id)) {
      throw new AppError('Shop not found', 404);
    }
  }

  const shop = await Shop.findById(req.params.id);
  if (!shop) throw new AppError('Shop not found', 404);
  return sendSuccess(res, 'Shop fetched successfully', { shop });
});

// POST /api/shops
const createShop = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  const openingTime = normalizeTime(payload.opening_time) || '00:00';
  const closingTime = normalizeTime(payload.closing_time) || '23:59';
  payload.opening_time = openingTime;
  payload.closing_time = closingTime;

  const shop = await Shop.create(payload);
  appendShopTimeHistory(shop, {
    openingTime,
    closingTime,
    changedBy: req.user?._id || null,
    note: 'Initial shop operating hours',
    changedAt: shop.createdAt || new Date(),
  });
  await shop.save();
  return sendSuccess(res, 'Shop created successfully', { shop }, 201);
});

// PUT /api/shops/:id
const updateShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findById(req.params.id);
  if (!shop) throw new AppError('Shop not found', 404);

  const prevOpening = shop.opening_time;
  const prevClosing = shop.closing_time;
  const nextOpening = normalizeTime(req.body.opening_time);
  const nextClosing = normalizeTime(req.body.closing_time);

  if (req.body.name !== undefined) shop.name = req.body.name;
  if (req.body.latitude !== undefined) shop.latitude = req.body.latitude;
  if (req.body.longitude !== undefined) shop.longitude = req.body.longitude;
  if (req.body.geofence_radius_m !== undefined) shop.geofence_radius_m = req.body.geofence_radius_m;
  if (nextOpening !== null) shop.opening_time = nextOpening;
  if (nextClosing !== null) shop.closing_time = nextClosing;

  const openingChanged = nextOpening !== null && nextOpening !== prevOpening;
  const closingChanged = nextClosing !== null && nextClosing !== prevClosing;

  if (openingChanged || closingChanged) {
    appendShopTimeHistory(shop, {
      openingTime: nextOpening || shop.opening_time,
      closingTime: nextClosing || shop.closing_time,
      changedBy: req.user?._id || null,
      note: req.body?.time_change_note || 'Shop operating hours updated',
    });
  }

  await shop.save();
  return sendSuccess(res, 'Shop updated successfully', { shop });
});

// PUT /api/shops/:id/hours
const updateShopHours = asyncHandler(async (req, res) => {
  const { opening_time, closing_time, note = null } = req.body;
  if (!opening_time || !closing_time) {
    throw new AppError('opening_time and closing_time are required', 400);
  }

  const shop = await Shop.findById(req.params.id);
  if (!shop) throw new AppError('Shop not found', 404);

  shop.opening_time = String(opening_time).trim();
  shop.closing_time = String(closing_time).trim();
  appendShopTimeHistory(shop, {
    openingTime: shop.opening_time,
    closingTime: shop.closing_time,
    changedBy: req.user?._id || null,
    note: note || 'Shop operating hours updated',
  });

  await shop.save();
  return sendSuccess(res, 'Shop operating hours updated successfully', {
    shop,
  });
});

// GET /api/shops/:id/hours-history
const getShopHoursHistory = asyncHandler(async (req, res) => {
  const shop = await Shop.findById(req.params.id).populate(
    'shop_time_history.changed_by',
    'name email'
  );
  if (!shop) throw new AppError('Shop not found', 404);

  const { page, limit } = parsePagination(req.query, {
    defaultSortBy: 'createdAt',
    allowedSortBy: ['createdAt'],
  });
  const history = Array.isArray(shop.shop_time_history) ? shop.shop_time_history : [];
  const start = (page - 1) * limit;
  const pagedHistory = history.slice(start, start + limit);

  return sendSuccess(res, 'Shop hours history fetched successfully', {
    shop_id: shop._id,
    opening_time: shop.opening_time,
    closing_time: shop.closing_time,
    ...toPageMeta(history.length, page, limit, pagedHistory.length),
    history: pagedHistory,
  });
});

// DELETE /api/shops/:id
const deleteShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findByIdAndDelete(req.params.id);
  if (!shop) throw new AppError('Shop not found', 404);
  return sendSuccess(res, 'Shop deleted', { shop });
});

module.exports = {
  getShops,
  getShop,
  createShop,
  updateShop,
  updateShopHours,
  getShopHoursHistory,
  deleteShop,
};
