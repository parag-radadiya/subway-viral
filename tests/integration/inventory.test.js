const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const InventoryItem = require('../../src/models/InventoryItem');
const InventoryQuery = require('../../src/models/InventoryQuery');
const InventoryAuditLog = require('../../src/models/InventoryAuditLog');
const User = require('../../src/models/User');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('Inventory and query module integration', () => {
  let fixtures;

  beforeAll(async () => {
    await connectSandboxDb();
  });

  beforeEach(async () => {
    await clearSandboxDb();
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await disconnectSandboxDb();
  });

  it('INV-001 and INV-002: lists inventory for privileged user and blocks employee', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const okRes = await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${managerLogin.token}`);

    expectEnvelope(okRes, 200);
    expect(okRes.body.data.count).toBeGreaterThan(0);

    const blockedRes = await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${staffLogin.token}`);

    expectEnvelope(blockedRes, 403);
  });

  it('INV-012: supports inventory list pagination and sorting', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    await InventoryItem.create({
      shop_id: fixtures.shops.mainShop._id,
      item_name: 'A Item',
      status: 'Good',
    });
    await InventoryItem.create({
      shop_id: fixtures.shops.mainShop._id,
      item_name: 'Z Item',
      status: 'Good',
    });

    const res = await request(app)
      .get('/api/inventory/items?page=1&limit=2&sort_by=item_name&sort_order=asc')
      .set('Authorization', `Bearer ${managerLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.limit).toBe(2);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.total).toBeGreaterThanOrEqual(4);
    expect(res.body.data.items[0].item_name <= res.body.data.items[1].item_name).toBe(true);
  });

  it('INV-003 and INV-004: creates inventory item and validates missing fields', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const createdRes = await request(app)
      .post('/api/inventory/items')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        item_name: 'Hand Scanner',
        status: 'Good',
      });
    expectEnvelope(createdRes, 201);

    const invalidRes = await request(app)
      .post('/api/inventory/items')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ shop_id: fixtures.shops.mainShop._id.toString() });
    expectEnvelope(invalidRes, 400);
  });

  it('INV-005 and INV-006: gets inventory item and handles not found', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const targetItem = fixtures.inventoryItems[0];

    const successRes = await request(app)
      .get(`/api/inventory/items/${targetItem._id}`)
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(successRes, 200);

    const notFoundRes = await request(app)
      .get('/api/inventory/items/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(notFoundRes, 404);
  });

  it('INV-007 and INV-008: updates and deletes inventory item', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const targetItem = fixtures.inventoryItems[0];

    const updateRes = await request(app)
      .put(`/api/inventory/items/${targetItem._id}`)
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ item_name: 'Cash Register Rev 2', status: 'In Repair' });
    expectEnvelope(updateRes, 200);
    expect(updateRes.body.data.item.status).toBe('In Repair');

    const deleteRes = await request(app)
      .delete(`/api/inventory/items/${targetItem._id}`)
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(deleteRes, 200);
  });

  it('QRY-002 and QRY-005: opening and closing query updates item status automatically', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const targetItem = fixtures.inventoryItems[0];

    const openRes = await request(app)
      .post('/api/inventory/queries')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        item_id: targetItem._id.toString(),
        issue_note: 'Screen not booting',
      });

    expectEnvelope(openRes, 201);

    const damaged = await InventoryItem.findById(targetItem._id);
    expect(damaged.status).toBe('Damaged');

    const queryId = openRes.body.data.query._id;
    const closeRes = await request(app)
      .put(`/api/inventory/queries/${queryId}/close`)
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        repair_cost: 120,
        resolve_note: 'Power unit replaced',
      });

    expectEnvelope(closeRes, 200);

    const reverted = await InventoryItem.findById(targetItem._id);
    expect(reverted.status).toBe('Good');
  });

  it('QRY-007: blocks inventory query endpoints for user without permission', async () => {
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const res = await request(app)
      .get('/api/inventory/queries')
      .set('Authorization', `Bearer ${staffLogin.token}`);

    expectEnvelope(res, 403);
  });

  it('QRY-003: rejects query creation for invalid item', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const res = await request(app)
      .post('/api/inventory/queries')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ item_id: '507f1f77bcf86cd799439011', issue_note: 'Invalid item case' });

    expectEnvelope(res, 404);
  });

  it('QRY-004 and QRY-006: gets query by id and prevents closing already closed query', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const targetItem = fixtures.inventoryItems[1];

    const openRes = await request(app)
      .post('/api/inventory/queries')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ item_id: targetItem._id.toString(), issue_note: 'Panel cracked' });
    expectEnvelope(openRes, 201);

    const queryId = openRes.body.data.query._id;
    const getRes = await request(app)
      .get(`/api/inventory/queries/${queryId}`)
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(getRes, 200);

    const closeRes = await request(app)
      .put(`/api/inventory/queries/${queryId}/close`)
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ resolve_note: 'Repaired' });
    expectEnvelope(closeRes, 200);

    const closeAgainRes = await request(app)
      .put(`/api/inventory/queries/${queryId}/close`)
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ resolve_note: 'Duplicate close' });
    expectEnvelope(closeAgainRes, 409);
  });

  it('QRY-010: supports inventory query list pagination and sorting', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const queryA = await request(app)
      .post('/api/inventory/queries')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ item_id: fixtures.inventoryItems[0]._id.toString(), issue_note: 'Query A' });
    expectEnvelope(queryA, 201);

    const queryB = await request(app)
      .post('/api/inventory/queries')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ item_id: fixtures.inventoryItems[1]._id.toString(), issue_note: 'Query B' });
    expectEnvelope(queryB, 201);

    const res = await request(app)
      .get('/api/inventory/queries?page=1&limit=1&sort_by=createdAt&sort_order=desc')
      .set('Authorization', `Bearer ${managerLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.limit).toBe(1);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.total).toBeGreaterThanOrEqual(2);
    expect(res.body.data.queries.length).toBe(1);
  });

  it('INV-009: manager list is limited to assigned shops', async () => {
    await User.findByIdAndUpdate(fixtures.users.managerUser._id, {
      assigned_shop_ids: [fixtures.shops.mainShop._id],
      shop_id: fixtures.shops.mainShop._id,
    });

    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const res = await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${managerLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.items[0].shop_id._id).toBe(fixtures.shops.mainShop._id.toString());
  });

  it('INV-010: manager cannot read or create items outside assigned shops', async () => {
    await User.findByIdAndUpdate(fixtures.users.managerUser._id, {
      assigned_shop_ids: [fixtures.shops.mainShop._id],
      shop_id: fixtures.shops.mainShop._id,
    });

    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const eastItem = fixtures.inventoryItems[1];

    const readRes = await request(app)
      .get(`/api/inventory/items/${eastItem._id}`)
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(readRes, 404);

    const createRes = await request(app)
      .post('/api/inventory/items')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.eastShop._id.toString(),
        item_name: 'Unauthorized Scanner',
        status: 'Good',
      });
    expectEnvelope(createRes, 403);
  });

  it('QRY-008: manager cannot open or close queries outside assigned shops', async () => {
    await User.findByIdAndUpdate(fixtures.users.managerUser._id, {
      assigned_shop_ids: [fixtures.shops.mainShop._id],
      shop_id: fixtures.shops.mainShop._id,
    });

    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const eastItem = fixtures.inventoryItems[1];

    const openBlocked = await request(app)
      .post('/api/inventory/queries')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ item_id: eastItem._id.toString(), issue_note: 'Out of scope item' });
    expectEnvelope(openBlocked, 403);

    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const adminOpen = await request(app)
      .post('/api/inventory/queries')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ item_id: eastItem._id.toString(), issue_note: 'Admin opened east query' });
    expectEnvelope(adminOpen, 201);

    const queryId = adminOpen.body.data.query._id;
    const closeBlocked = await request(app)
      .put(`/api/inventory/queries/${queryId}/close`)
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ resolve_note: 'Manager out of scope close attempt' });
    expectEnvelope(closeBlocked, 403);

    const queryStillOpen = await InventoryQuery.findById(queryId);
    expect(queryStillOpen.status).toBe('Open');
  });

  it('QRY-009: blocks opening a second open query for the same item', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const targetItem = fixtures.inventoryItems[0];

    const firstOpen = await request(app)
      .post('/api/inventory/queries')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ item_id: targetItem._id.toString(), issue_note: 'Primary issue' });
    expectEnvelope(firstOpen, 201);

    const secondOpen = await request(app)
      .post('/api/inventory/queries')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ item_id: targetItem._id.toString(), issue_note: 'Duplicate open issue' });
    expectEnvelope(secondOpen, 409);
  });

  it('INV-011: blocks deleting an inventory item when linked queries exist', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const targetItem = fixtures.inventoryItems[0];

    const openRes = await request(app)
      .post('/api/inventory/queries')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ item_id: targetItem._id.toString(), issue_note: 'Delete guard test' });
    expectEnvelope(openRes, 201);

    const deleteRes = await request(app)
      .delete(`/api/inventory/items/${targetItem._id}`)
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(deleteRes, 409);
  });

  it('QRY-011: close keeps item Damaged when legacy duplicate open query exists', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const itemId = fixtures.inventoryItems[0]._id;
    const shopId = fixtures.shops.mainShop._id;
    const actorId = fixtures.users.managerUser._id;
    const firstId = new mongoose.Types.ObjectId();
    const secondId = new mongoose.Types.ObjectId();

    try {
      await InventoryQuery.collection.dropIndex('unique_open_query_per_item');
    } catch (_) {
      // ignore when index is not present in this sandbox lifecycle
    }

    try {
      await InventoryItem.findByIdAndUpdate(itemId, { status: 'Damaged' });
      await InventoryQuery.collection.insertMany([
        {
          _id: firstId,
          item_id: itemId,
          shop_id: shopId,
          reported_by: actorId,
          issue_note: 'Legacy open issue 1',
          status: 'Open',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          _id: secondId,
          item_id: itemId,
          shop_id: shopId,
          reported_by: actorId,
          issue_note: 'Legacy open issue 2',
          status: 'Open',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const closeRes = await request(app)
        .put(`/api/inventory/queries/${firstId}/close`)
        .set('Authorization', `Bearer ${managerLogin.token}`)
        .send({ resolve_note: 'Closed first legacy issue' });
      expectEnvelope(closeRes, 200);

      const itemAfterClose = await InventoryItem.findById(itemId);
      expect(itemAfterClose.status).toBe('Damaged');
    } finally {
      await InventoryQuery.syncIndexes();
    }
  });

  it('QRY-012: concurrent close requests return deterministic conflict for the second caller', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');
    const targetItem = fixtures.inventoryItems[0];

    const openRes = await request(app)
      .post('/api/inventory/queries')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ item_id: targetItem._id.toString(), issue_note: 'Concurrency close test' });
    expectEnvelope(openRes, 201);

    const queryId = openRes.body.data.query._id;
    const [firstClose, secondClose] = await Promise.all([
      request(app)
        .put(`/api/inventory/queries/${queryId}/close`)
        .set('Authorization', `Bearer ${managerLogin.token}`)
        .send({ resolve_note: 'close-1' }),
      request(app)
        .put(`/api/inventory/queries/${queryId}/close`)
        .set('Authorization', `Bearer ${managerLogin.token}`)
        .send({ resolve_note: 'close-2' }),
    ]);

    const codes = [firstClose.statusCode, secondClose.statusCode].sort();
    expect(codes).toEqual([200, 409]);
  });

  it('AUD-001: audit logs capture item/query lifecycle and support pagination', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const createItemRes = await request(app)
      .post('/api/inventory/items')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({
        shop_id: fixtures.shops.mainShop._id.toString(),
        item_name: 'Audit Item',
        status: 'Good',
      });
    expectEnvelope(createItemRes, 201);
    const itemId = createItemRes.body.data.item._id;

    const updateItemRes = await request(app)
      .put(`/api/inventory/items/${itemId}`)
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ status: 'In Repair' });
    expectEnvelope(updateItemRes, 200);

    const openQueryRes = await request(app)
      .post('/api/inventory/queries')
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ item_id: itemId, issue_note: 'Audit query open' });
    expectEnvelope(openQueryRes, 201);

    const closeQueryRes = await request(app)
      .put(`/api/inventory/queries/${openQueryRes.body.data.query._id}/close`)
      .set('Authorization', `Bearer ${managerLogin.token}`)
      .send({ resolve_note: 'Audit query close' });
    expectEnvelope(closeQueryRes, 200);

    const logsRes = await request(app)
      .get('/api/inventory/audit-logs?page=1&limit=2&sort_by=createdAt&sort_order=desc')
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(logsRes, 200);
    expect(logsRes.body.data.limit).toBe(2);
    expect(logsRes.body.data.page).toBe(1);
    expect(logsRes.body.data.total).toBeGreaterThanOrEqual(4);
    expect(logsRes.body.data.logs.length).toBe(2);

    const totalAuditEntries = await InventoryAuditLog.countDocuments({});
    expect(totalAuditEntries).toBeGreaterThanOrEqual(4);
  });
});
