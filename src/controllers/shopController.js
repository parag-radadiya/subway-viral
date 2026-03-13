const Shop = require('../models/Shop');
const { isShopAllowed } = require('../middleware/shopScopeMiddleware');

// GET /api/shops
const getShops = async (req, res) => {
  try {
    let shops;
    if (req.shopScope?.all) {
      shops = await Shop.find();
    } else if (req.shopScope?.ids?.length) {
      shops = await Shop.find({ _id: { $in: req.shopScope.ids } });
    } else {
      shops = [];
    }

    res.json({ success: true, data: shops });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/shops/:id
const getShop = async (req, res) => {
  try {
    if (!isShopAllowed(req.shopScope, req.params.id)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: you can only access your assigned shops',
      });
    }

    const shop = await Shop.findById(req.params.id);
    if (!shop) return res.status(404).json({ success: false, message: 'Shop not found' });
    res.json({ success: true, data: shop });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/shops
const createShop = async (req, res) => {
  try {
    const shop = await Shop.create(req.body);
    res.status(201).json({ success: true, data: shop });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/shops/:id
const updateShop = async (req, res) => {
  try {
    const shop = await Shop.findByIdAndUpdate(req.params.id, req.body, {
      new: true, runValidators: true,
    });
    if (!shop) return res.status(404).json({ success: false, message: 'Shop not found' });
    res.json({ success: true, data: shop });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/shops/:id
const deleteShop = async (req, res) => {
  try {
    const shop = await Shop.findByIdAndDelete(req.params.id);
    if (!shop) return res.status(404).json({ success: false, message: 'Shop not found' });
    res.json({ success: true, message: 'Shop deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getShops, getShop, createShop, updateShop, deleteShop };
