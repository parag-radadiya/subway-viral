const mongoose = require('mongoose');

const inventoryQuerySchema = new mongoose.Schema(
  {
    item_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryItem',
      required: [true, 'Item is required'],
    },
    shop_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: [true, 'Shop is required'],
    },
    reported_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Reporter is required'],
    },
    issue_note: {
      type: String,
      required: [true, 'Issue description is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['Open', 'Closed'],
      default: 'Open',
    },
    repair_cost: {
      type: Number,
      default: null,
    },
    resolve_note: {
      type: String,
      default: null,
      trim: true,
    },
    resolved_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolved_at: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// At most one active query can exist per inventory item.
inventoryQuerySchema.index(
  { item_id: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'Open' },
    name: 'unique_open_query_per_item',
  }
);

inventoryQuerySchema.index(
  { item_id: 1, status: 1, shop_id: 1, createdAt: -1 },
  { name: 'idx_query_item_status_shop_created' }
);

module.exports = mongoose.model('InventoryQuery', inventoryQuerySchema);
