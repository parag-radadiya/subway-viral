const Shop = require('../models/Shop');

/**
 * Haversine formula — returns distance between two lat/lng points in metres.
 */
const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000; // Earth radius in metres
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Validates that the employee is within the shop's geofence.
 * Expects req.body: { shop_id, latitude, longitude }
 * Attaches req.shop on success.
 */
const validateGeofence = async (req, res, next) => {
  try {
    const { shop_id, latitude, longitude } = req.body;

    if (!shop_id || latitude == null || longitude == null) {
      return res.status(400).json({
        success: false,
        message: 'shop_id, latitude, and longitude are required',
      });
    }

    const shop = await Shop.findById(shop_id);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }

    const distance = haversineDistance(
      latitude,
      longitude,
      shop.latitude,
      shop.longitude
    );

    if (distance > shop.geofence_radius_m) {
      return res.status(403).json({
        success: false,
        message: `You are ${Math.round(distance)}m away. Must be within ${shop.geofence_radius_m}m of ${shop.name}.`,
      });
    }

    req.shop = shop;
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { validateGeofence, haversineDistance };
