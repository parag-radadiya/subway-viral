const InventoryAuditLog = require('../models/InventoryAuditLog');

const toPlain = (doc) => {
  if (!doc) return null;
  if (typeof doc.toObject === 'function') return doc.toObject();
  return doc;
};

const recordInventoryAudit = async ({
  action,
  performedBy,
  shopId,
  itemId = null,
  queryId = null,
  beforeState = null,
  afterState = null,
  metadata = null,
}) => {
  await InventoryAuditLog.create({
    action,
    performed_by: performedBy,
    shop_id: shopId,
    item_id: itemId,
    query_id: queryId,
    before_state: toPlain(beforeState),
    after_state: toPlain(afterState),
    metadata,
  });
};

module.exports = { recordInventoryAudit };
