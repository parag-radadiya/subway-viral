const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    shop_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: true,
    },
    rota_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Rota',
      required: false,
      default: null,
    },
    punch_in: {
      type: Date,
      default: Date.now,
    },
    punch_out: {
      type: Date,
      default: null,
    },
    auto_punch_out_at: {
      type: Date,
      default: null,
    },
    punch_out_source: {
      type: String,
      enum: ['Manual', 'Auto'],
      default: null,
    },
    is_manual: {
      type: Boolean,
      default: false,
    },
    manual_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    punch_method: {
      type: String,
      enum: ['GPS+Biometric', 'Manual'],
      required: true,
    },
  },
  { timestamps: true }
);

attendanceSchema.index({ user_id: 1, punch_out: 1 }, { name: 'idx_user_open_attendance' });
attendanceSchema.index({ punch_out: 1, auto_punch_out_at: 1 }, { name: 'idx_auto_punch_due' });

module.exports = mongoose.model('Attendance', attendanceSchema);
