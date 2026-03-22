const Shop = require('../models/Shop');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const {
  buildShopScope,
  isShopAllowed,
  buildReadScope,
} = require('../middleware/shopScopeMiddleware');

// GET /api/shops
const getShops = asyncHandler(async (req, res) => {
  const scope = buildReadScope(req.user);

  if (scope.mode === 'all') {
    const shops = await Shop.find();
    return sendSuccess(res, 'Shops fetched successfully', { shops });
  }

  const shopScope = buildShopScope(req.user);
  if (!shopScope.all && shopScope.ids.length === 0) {
    return sendSuccess(res, 'Shops fetched successfully', { shops: [] });
  }

  const shops = await Shop.find(shopScope.all ? {} : { _id: { $in: shopScope.ids } });
  return sendSuccess(res, 'Shops fetched successfully', { shops });
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
  const shop = await Shop.create(req.body);
  return sendSuccess(res, 'Shop created successfully', { shop }, 201);
});

// PUT /api/shops/:id
const updateShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findByIdAndUpdate(req.params.id, req.body, {
    new: true, runValidators: true,
  });
  if (!shop) throw new AppError('Shop not found', 404);
  return sendSuccess(res, 'Shop updated successfully', { shop });
});

// DELETE /api/shops/:id
const deleteShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findByIdAndDelete(req.params.id);
  if (!shop) throw new AppError('Shop not found', 404);
  return sendSuccess(res, 'Shop deleted', { shop });
});

module.exports = { getShops, getShop, createShop, updateShop, deleteShop };
