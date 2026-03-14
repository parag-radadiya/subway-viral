const InventoryItem = require('../models/InventoryItem');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');

// GET /api/inventory/items
const getItems = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.shop_id) filter.shop_id = req.query.shop_id;
  if (req.query.status) filter.status = req.query.status;

  const items = await InventoryItem.find(filter).populate('shop_id', 'name');
  return sendSuccess(res, 'Inventory items fetched successfully', {
    count: items.length,
    items,
  });
});

// GET /api/inventory/items/:id
const getItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id).populate('shop_id', 'name');
  if (!item) throw new AppError('Item not found', 404);
  return sendSuccess(res, 'Inventory item fetched successfully', { item });
});

// POST /api/inventory/items
const createItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.create(req.body);
  return sendSuccess(res, 'Inventory item created successfully', { item }, 201);
});

// PUT /api/inventory/items/:id
const updateItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findByIdAndUpdate(req.params.id, req.body, {
    new: true, runValidators: true,
  });
  if (!item) throw new AppError('Item not found', 404);
  return sendSuccess(res, 'Inventory item updated successfully', { item });
});

// DELETE /api/inventory/items/:id
const deleteItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findByIdAndDelete(req.params.id);
  if (!item) throw new AppError('Item not found', 404);
  return sendSuccess(res, 'Inventory item deleted', { item });
});

module.exports = { getItems, getItem, createItem, updateItem, deleteItem };
