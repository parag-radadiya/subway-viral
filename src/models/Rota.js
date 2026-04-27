const mongoose = require('mongoose');

const toIsoDate = (date) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const toHHMM = (date) => {
  const d = new Date(date);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

const combineDateAndTime = (date, time) => {
  if (!date || !time) return null;
  const [h, m] = String(time).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const base = new Date(date);
  base.setUTCHours(h, m, 0, 0);
  return base;
};

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
      required: false,
    },
    shift_start: {
      type: Date,
      required: [true, 'Shift start datetime is required'],
    },
    shift_end: {
      type: Date,
      required: [true, 'Shift end datetime is required'],
    },
    start_time: {
      type: String,
      required: false,
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

rotaSchema.pre('validate', function () {
  if (!this.shift_start && this.shift_date && this.start_time) {
    this.shift_start = combineDateAndTime(this.shift_date, this.start_time);
  }
  if (!this.shift_end && this.shift_date && this.end_time) {
    this.shift_end = combineDateAndTime(this.shift_date, this.end_time);
  }

  if (this.shift_start && !this.shift_date) {
    this.shift_date = toIsoDate(this.shift_start);
  }
  if (this.shift_start && !this.start_time) {
    this.start_time = toHHMM(this.shift_start);
  }
  if (this.shift_end && !this.end_time) {
    this.end_time = toHHMM(this.shift_end);
  }

  if (this.shift_start && this.shift_end && this.shift_end <= this.shift_start) {
    this.invalidate('shift_end', 'Shift end must be after shift start');
  }
});

// Unique per user+shift_start — allows split shifts but avoids duplicates.
rotaSchema.index({ user_id: 1, shift_start: 1 }, { unique: true, name: 'unique_user_shiftstart' });

// Helps overlap checks (user + time window queries).
rotaSchema.index({ user_id: 1, shift_start: 1, shift_end: 1 }, { name: 'idx_user_shift_window' });

module.exports = mongoose.model('Rota', rotaSchema);
