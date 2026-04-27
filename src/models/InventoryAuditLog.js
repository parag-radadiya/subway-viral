const mongoose = require('mongoose');

const inventoryAuditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: ['ITEM_CREATED', 'ITEM_UPDATED', 'ITEM_DELETED', 'QUERY_OPENED', 'QUERY_CLOSED'],
    },
    performed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    shop_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: true,
    },
    item_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryItem',
      default: null,
    },
    query_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryQuery',
      default: null,
    },
    before_state: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    after_state: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

inventoryAuditLogSchema.index({ shop_id: 1, createdAt: -1 }, { name: 'idx_audit_shop_created' });
inventoryAuditLogSchema.index({ action: 1, createdAt: -1 }, { name: 'idx_audit_action_created' });

module.exports = mongoose.model('InventoryAuditLog', inventoryAuditLogSchema);
