const mongoose = require('mongoose');

const requestMetricSchema = new mongoose.Schema(
  {
    day: {
      type: Date,
      required: true,
      index: true,
    },
    route: {
      type: String,
      required: true,
      trim: true,
    },
    method: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    status_code: {
      type: Number,
      required: true,
      min: 100,
      max: 599,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
    total_response_ms: {
      type: Number,
      default: 0,
      min: 0,
    },
    min_response_ms: {
      type: Number,
      default: 0,
      min: 0,
    },
    max_response_ms: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

requestMetricSchema.index({ day: 1, route: 1, method: 1, status_code: 1 }, { unique: true });

module.exports = mongoose.model('RequestMetric', requestMetricSchema);
