const Attendance = require('../models/Attendance');

async function reconcileOverdueAutoPunchOuts({ userId = null, limit = 200 } = {}) {
  const now = new Date();
  const filter = {
    punch_out: null,
    auto_punch_out_at: { $ne: null, $lte: now },
  };

  if (userId) {
    filter.user_id = userId;
  }

  const due = await Attendance.find(filter)
    .select('_id auto_punch_out_at')
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
  return { processed: due.length, updated };
}

async function reconcileUserOverdueAutoPunchOuts(userId, options = {}) {
  return reconcileOverdueAutoPunchOuts({ ...options, userId });
}

module.exports = {
  reconcileOverdueAutoPunchOuts,
  reconcileUserOverdueAutoPunchOuts,
};
