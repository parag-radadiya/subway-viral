const mongoose = require('mongoose');

const errorLogSchema = new mongoose.Schema(
  {
    status_code: {
      type: Number,
      required: true,
      min: 100,
      max: 599,
      index: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    path: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    method: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    ip: {
      type: String,
      default: null,
      trim: true,
    },
    user_agent: {
      type: String,
      default: null,
      trim: true,
    },
    stack: {
      type: String,
      default: null,
    },
    meta: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

errorLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ErrorLog', errorLogSchema);

