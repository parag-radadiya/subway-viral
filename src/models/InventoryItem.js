const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema(
  {
    shop_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: [true, 'Shop is required'],
    },
    item_name: {
      type: String,
      required: [true, 'Item name is required'],
      trim: true,
    },
    purchase_date: {
      type: Date,
      default: null,
    },
    expiry_date: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['Good', 'Damaged', 'In Repair'],
      default: 'Good',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
