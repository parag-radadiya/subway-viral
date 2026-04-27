const mongoose = require('mongoose');

const storeReportWeekly2026BSchema = new mongoose.Schema(
  {
    shop_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      default: null,
      index: true,
    },
    store_name_raw: {
      type: String,
      required: true,
      trim: true,
    },
    store_key: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    source_sheet: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    period_key: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    year: {
      type: Number,
      required: true,
      min: 2000,
      max: 3000,
      index: true,
    },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
      index: true,
    },
    week_number: {
      type: Number,
      required: true,
      min: 1,
      max: 53,
      index: true,
    },
    week_start: {
      type: Date,
      default: null,
    },
    week_end: {
      type: Date,
      default: null,
    },
    week_range_label: {
      type: String,
      default: null,
      trim: true,
    },
    metrics: {
      type: Object,
      default: {},
    },
    source_file: {
      type: String,
      default: null,
      trim: true,
    },
    imported_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

storeReportWeekly2026BSchema.index(
  { source_sheet: 1, period_key: 1, store_key: 1 },
  { unique: true }
);

module.exports = mongoose.model('StoreReportWeekly2026B', storeReportWeekly2026BSchema);

