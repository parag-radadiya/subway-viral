const mongoose = require('mongoose');

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toMinutes = (value) => {
  const [h, m] = String(value).split(':').map(Number);
  return h * 60 + m;
};

const shopSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Shop name is required'],
      trim: true,
    },
    latitude: {
      type: Number,
      required: [true, 'Latitude is required'],
    },
    longitude: {
      type: Number,
      required: [true, 'Longitude is required'],
    },
    geofence_radius_m: {
      type: Number,
      default: 100, // 100 metres default
      min: [10, 'Geofence radius must be at least 10 metres'],
    },
    opening_time: {
      type: String,
      default: '00:00',
      validate: {
        validator: (value) => HHMM_RE.test(String(value || '')),
        message: 'opening_time must be in HH:MM 24-hour format',
      },
    },
    closing_time: {
      type: String,
      default: '23:59',
      validate: {
        validator: (value) => HHMM_RE.test(String(value || '')),
        message: 'closing_time must be in HH:MM 24-hour format',
      },
    },
    shop_time_history: [
      {
        opening_time: {
          type: String,
          required: true,
          validate: {
            validator: (value) => HHMM_RE.test(String(value || '')),
            message: 'history opening_time must be in HH:MM 24-hour format',
          },
        },
        closing_time: {
          type: String,
          required: true,
          validate: {
            validator: (value) => HHMM_RE.test(String(value || '')),
            message: 'history closing_time must be in HH:MM 24-hour format',
          },
        },
        effective_from: {
          type: Date,
          required: true,
        },
        effective_to: {
          type: Date,
          default: null,
        },
        changed_at: {
          type: Date,
          default: Date.now,
        },
        changed_by: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          default: null,
        },
        note: {
          type: String,
          maxlength: 300,
          default: null,
        },
      },
    ],
  },
  { timestamps: true }
);

shopSchema.pre('validate', function () {
  if (!this.opening_time || !this.closing_time) return;
  if (!HHMM_RE.test(this.opening_time) || !HHMM_RE.test(this.closing_time)) return;

  const openMinutes = toMinutes(this.opening_time);
  const closeMinutes = toMinutes(this.closing_time);
  if (closeMinutes <= openMinutes) {
    this.invalidate('closing_time', 'closing_time must be after opening_time on the same day');
  }
});

module.exports = mongoose.model('Shop', shopSchema);
