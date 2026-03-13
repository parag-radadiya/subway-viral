const InventoryItem = require('../models/InventoryItem');
const { isShopAllowed } = require('../middleware/shopScopeMiddleware');

const canReadShop = (req, shopId) => {
  return isShopAllowed(req.shopScope, shopId);
};

// GET /api/inventory/items
const getItems = async (req, res) => {
  try {
    const filter = {};
    if (req.query.shop_id) filter.shop_id = req.query.shop_id;
    if (req.query.status) filter.status = req.query.status;

    if (!req.shopScope?.all) {
      if (req.query.shop_id && !canReadShop(req, req.query.shop_id)) {
        return res.status(403).json({ success: false, message: 'Forbidden: shop is outside your assigned scope' });
      }
      filter.shop_id = req.query.shop_id || { $in: req.shopScope?.ids || [] };
    }

    const items = await InventoryItem.find(filter).populate('shop_id', 'name');
    res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/inventory/items/:id
const getItem = async (req, res) => {
  try {
    const item = await InventoryItem.findById(req.params.id).populate('shop_id', 'name');
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    if (!canReadShop(req, item.shop_id?._id || item.shop_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: item is outside your assigned shops' });
    }
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/inventory/items
const createItem = async (req, res) => {
  try {
    if (!canReadShop(req, req.body.shop_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: shop is outside your assigned scope' });
    }

    const item = await InventoryItem.create(req.body);
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/inventory/items/:id
const updateItem = async (req, res) => {
  try {
    const item = await InventoryItem.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    if (!canReadShop(req, item.shop_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: item is outside your assigned shops' });
    }
    if (req.body.shop_id && !canReadShop(req, req.body.shop_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: target shop is outside your assigned scope' });
    }

    Object.assign(item, req.body);
    await item.save();
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/inventory/items/:id
const deleteItem = async (req, res) => {
  try {
    const item = await InventoryItem.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    if (!canReadShop(req, item.shop_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: item is outside your assigned shops' });
    }

    await item.deleteOne();
    res.json({ success: true, message: 'Item deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getItems, getItem, createItem, updateItem, deleteItem };
