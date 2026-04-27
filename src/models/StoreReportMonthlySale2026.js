const mongoose = require('mongoose');

const storeReportMonthlySale2026Schema = new mongoose.Schema(
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

storeReportMonthlySale2026Schema.index(
  { source_sheet: 1, period_key: 1, store_key: 1 },
  { unique: true }
);

module.exports = mongoose.model('StoreReportMonthlySale2026', storeReportMonthlySale2026Schema);
