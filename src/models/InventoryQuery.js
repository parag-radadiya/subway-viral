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
      enum: ['Open', 'Resolved', 'Closed'],
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

module.exports = mongoose.model('InventoryQuery', inventoryQuerySchema);
