const mongoose = require('mongoose');

const storeReportEntrySchema = new mongoose.Schema(
  {
    shop_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: true,
      index: true,
    },
    report_type: {
      type: String,
      enum: ['weekly_financial', 'monthly_store_kpi'],
      required: true,
      index: true,
    },
    source_type: {
      type: String,
      enum: ['excel_raw', 'admin_weekly'],
      required: true,
      index: true,
    },
    period_key: {
      type: String,
      required: true,
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
      min: 1,
      max: 53,
      default: null,
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
    store_name_raw: {
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

storeReportEntrySchema.index(
  { shop_id: 1, report_type: 1, source_type: 1, period_key: 1 },
  { unique: true }
);

storeReportEntrySchema.index({
  source_type: 1,
  report_type: 1,
  year: 1,
  month: 1,
  week_number: 1,
  shop_id: 1,
});

module.exports = mongoose.model('StoreReportEntry', storeReportEntrySchema);
