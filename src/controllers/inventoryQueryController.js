const InventoryQuery = require('../models/InventoryQuery');
const InventoryItem = require('../models/InventoryItem');
const { isShopAllowed } = require('../middleware/shopScopeMiddleware');

const canReadShop = (req, shopId) => {
  return isShopAllowed(req.shopScope, shopId);
};

// GET /api/inventory/queries
const getQueries = async (req, res) => {
  try {
    const filter = {};
    if (req.query.shop_id) filter.shop_id = req.query.shop_id;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.item_id) filter.item_id = req.query.item_id;

    if (!req.shopScope?.all) {
      if (req.query.shop_id && !canReadShop(req, req.query.shop_id)) {
        return res.status(403).json({ success: false, message: 'Forbidden: shop is outside your assigned scope' });
      }
      filter.shop_id = req.query.shop_id || { $in: req.shopScope?.ids || [] };
    }

    const queries = await InventoryQuery.find(filter)
      .populate('item_id', 'item_name status')
      .populate('shop_id', 'name')
      .populate('reported_by', 'name email')
      .populate('resolved_by', 'name email')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: queries.length, data: queries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/inventory/queries/:id
const getQuery = async (req, res) => {
  try {
    const query = await InventoryQuery.findById(req.params.id)
      .populate('item_id', 'item_name status')
      .populate('shop_id', 'name')
      .populate('reported_by', 'name email')
      .populate('resolved_by', 'name email');

    if (!query) return res.status(404).json({ success: false, message: 'Query not found' });
    if (!canReadShop(req, query.shop_id?._id || query.shop_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: query is outside your assigned shops' });
    }
    res.json({ success: true, data: query });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/inventory/queries
// Creates the query ticket + auto-sets item status to 'Damaged'
const createQuery = async (req, res) => {
  try {
    const { item_id, shop_id, issue_note } = req.body;

    // Verify item exists
    const item = await InventoryItem.findById(item_id);
    if (!item) return res.status(404).json({ success: false, message: 'Inventory item not found' });
    if (!canReadShop(req, item.shop_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: item is outside your assigned shops' });
    }

    if (shop_id && item.shop_id.toString() !== shop_id.toString()) {
      return res.status(400).json({ success: false, message: 'shop_id must match the selected item shop' });
    }

    const resolvedShopId = shop_id || item.shop_id;
    if (!canReadShop(req, resolvedShopId)) {
      return res.status(403).json({ success: false, message: 'Forbidden: shop is outside your assigned scope' });
    }

    // Create the query (ticket)
    const query = await InventoryQuery.create({
      item_id,
      shop_id: resolvedShopId,
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

    res.status(201).json({
      success: true,
      message: 'Query opened and item marked as Damaged',
      data: populated,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/inventory/queries/:id/close
// Closes the query + auto-reverts item status to 'Good'
const closeQuery = async (req, res) => {
  try {
    const { repair_cost, resolve_note } = req.body;

    const query = await InventoryQuery.findById(req.params.id);
    if (!query) return res.status(404).json({ success: false, message: 'Query not found' });
    if (!canReadShop(req, query.shop_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: query is outside your assigned shops' });
    }

    if (query.status === 'Closed') {
      return res.status(400).json({ success: false, message: 'Query is already closed' });
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

    res.json({
      success: true,
      message: 'Query closed and item status reverted to Good',
      data: populated,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getQueries, getQuery, createQuery, closeQuery };
