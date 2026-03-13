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
    punch_in: {
      type: Date,
      default: Date.now,
    },
    punch_out: {
      type: Date,
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

module.exports = mongoose.model('Attendance', attendanceSchema);
