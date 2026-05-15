const mongoose = require('mongoose');

const CATEGORIES = ['attendance', 'inventory', 'rota', 'system'];
const SEVERITIES = ['info', 'warning', 'critical'];

const EVENT_TYPES = [
  // attendance
  'LATE_PUNCH_IN',
  'MISSED_PUNCH_IN',
  'AUTO_PUNCH_OUT',
  'MISSED_PUNCH_OUT',
  'MANUAL_PUNCH_IN',
  'ATTENDANCE_ADJUSTED',
  // inventory
  'INVENTORY_QUERY_OPENED',
  'INVENTORY_QUERY_CLOSED',
  'INVENTORY_ITEM_CREATED',
  'INVENTORY_ITEM_DAMAGED',
  // rota
  'ROTA_PUBLISHED',
  'ROTA_DELETED',
  // system
  'SHOP_HOURS_CHANGED',
  'USER_CREATED',
];

const notificationSchema = new mongoose.Schema(
  {
    recipient_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: CATEGORIES,
      required: true,
      index: true,
    },
    event_type: {
      type: String,
      enum: EVENT_TYPES,
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: SEVERITIES,
      default: 'info',
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    // related entity IDs — keep them flat so the frontend can deep-link
    actor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    shop_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      default: null,
      index: true,
    },
    target_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    attendance_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Attendance',
      default: null,
    },
    rota_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Rota',
      default: null,
    },
    inventory_item_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryItem',
      default: null,
    },
    inventory_query_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryQuery',
      default: null,
    },
    // bag for any extra data the frontend needs (numbers, dedupe keys, etc)
    metadata: {
      type: Object,
      default: {},
    },
    // dedupe key — if the same scan would emit the same event twice, we skip
    dedupe_key: {
      type: String,
      default: null,
      index: true,
    },
    read_at: {
      type: Date,
      default: null,
      index: true,
    },
    archived_at: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

// Useful compound indexes
notificationSchema.index({ recipient_id: 1, read_at: 1, createdAt: -1 });
notificationSchema.index({ recipient_id: 1, category: 1, createdAt: -1 });
notificationSchema.index(
  { recipient_id: 1, dedupe_key: 1 },
  { unique: true, partialFilterExpression: { dedupe_key: { $type: 'string' } } }
);

notificationSchema.statics.CATEGORIES = CATEGORIES;
notificationSchema.statics.SEVERITIES = SEVERITIES;
notificationSchema.statics.EVENT_TYPES = EVENT_TYPES;

module.exports = mongoose.model('Notification', notificationSchema);
