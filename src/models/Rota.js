const mongoose = require('mongoose');

const rotaSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },
    shop_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: [true, 'Shop is required'],
    },
    shift_date: {
      type: Date,
      required: [true, 'Shift date is required'],
    },
    start_time: {
      type: String,
      required: [true, 'Start time is required'],
      // "HH:MM" 24-hour format e.g. "09:00", "14:30"
    },
    end_time: {
      type: String,
      // Optional — "HH:MM" e.g. "17:00"
    },
    note: {
      type: String,
      maxlength: 300,
    },
  },
  { timestamps: true }
);

// Unique per user+date+start_time — allows split shifts (morning + evening)
// but prevents exact duplicate entries
rotaSchema.index(
  { user_id: 1, shift_date: 1, start_time: 1 },
  { unique: true, name: 'unique_user_date_starttime' }
);

module.exports = mongoose.model('Rota', rotaSchema);
