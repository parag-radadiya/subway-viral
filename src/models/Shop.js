const mongoose = require('mongoose');

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_MIN_SHIFT_DURATION_HOURS = 2;
const DEFAULT_MAX_SHIFT_DURATION_HOURS = 8;

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
    aliases: {
      type: [{ type: String, trim: true }],
      default: [],
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
    min_shift_duration_hours: {
      type: Number,
      default: DEFAULT_MIN_SHIFT_DURATION_HOURS,
      min: [0.25, 'min_shift_duration_hours must be at least 0.25 hours'],
    },
    max_shift_duration_hours: {
      type: Number,
      default: DEFAULT_MAX_SHIFT_DURATION_HOURS,
      min: [0.25, 'max_shift_duration_hours must be at least 0.25 hours'],
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
  if (closeMinutes === openMinutes) {
    this.invalidate('closing_time', 'closing_time cannot be equal to opening_time');
  }

  if (
    this.min_shift_duration_hours !== undefined &&
    this.max_shift_duration_hours !== undefined &&
    Number(this.min_shift_duration_hours) > Number(this.max_shift_duration_hours)
  ) {
    this.invalidate(
      'max_shift_duration_hours',
      'max_shift_duration_hours must be greater than or equal to min_shift_duration_hours'
    );
  }

  if (Array.isArray(this.shop_time_history)) {
    this.shop_time_history.forEach((entry, index) => {
      if (!entry?.opening_time || !entry?.closing_time) return;
      if (!HHMM_RE.test(entry.opening_time) || !HHMM_RE.test(entry.closing_time)) return;
      if (toMinutes(entry.opening_time) === toMinutes(entry.closing_time)) {
        this.invalidate(
          `shop_time_history.${index}.closing_time`,
          'history closing_time cannot be equal to history opening_time'
        );
      }
    });
  }
});

module.exports = mongoose.model('Shop', shopSchema);
