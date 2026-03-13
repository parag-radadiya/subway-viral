const mongoose = require('mongoose');

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
  },
  { timestamps: true }
);

module.exports = mongoose.model('Shop', shopSchema);
