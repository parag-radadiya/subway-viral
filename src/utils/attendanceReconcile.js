const Attendance = require('../models/Attendance');

async function reconcileOverdueAutoPunchOuts({ userId = null, limit = 200 } = {}) {
  const now = new Date();
  const filter = {
    punch_out: null,
    auto_punch_out_at: { $ne: null, $lte: now },
    // Skip records with a lunch break still in progress — matches the manual
    // punch-out rule that a shift can't be closed while a break is open.
    breaks: { $not: { $elemMatch: { break_end: null } } },
  };

  if (userId) {
    filter.user_id = userId;
  }

  const due = await Attendance.find(filter)
    .select('_id auto_punch_out_at user_id shop_id rota_id')
    .sort({ auto_punch_out_at: 1 })
    .limit(limit);

  if (due.length === 0) {
    return { processed: 0, updated: 0 };
  }

  const result = await Attendance.bulkWrite(
    due.map((record) => ({
      updateOne: {
        filter: { _id: record._id, punch_out: null },
        update: {
          $set: {
            punch_out: record.auto_punch_out_at,
            punch_out_source: 'Auto',
          },
        },
      },
    })),
    { ordered: false }
  );

  const updated = result.modifiedCount || result.nModified || 0;

  // Fire-and-forget notifications for each auto punch-out.
  // Lazy require to avoid circular deps with services that import models.
  if (updated > 0) {
    const notificationService = require('../services/notificationService');
    const User = require('../models/User');
    const Shop = require('../models/Shop');

    for (const record of due) {
      const [user, shop] = await Promise.all([
        User.findById(record.user_id).select('name email'),
        Shop.findById(record.shop_id).select('name'),
      ]);
      notificationService.notifyAutoPunchOut({
        attendance: {
          _id: record._id,
          shop_id: record.shop_id,
          user_id: record.user_id,
          rota_id: record.rota_id,
          auto_punch_out_at: record.auto_punch_out_at,
          punch_out: record.auto_punch_out_at,
        },
        user,
        shopName: shop?.name,
      });
    }
  }

  return { processed: due.length, updated };
}

async function reconcileUserOverdueAutoPunchOuts(userId, options = {}) {
  return reconcileOverdueAutoPunchOuts({ ...options, userId });
}

module.exports = {
  reconcileOverdueAutoPunchOuts,
  reconcileUserOverdueAutoPunchOuts,
};
