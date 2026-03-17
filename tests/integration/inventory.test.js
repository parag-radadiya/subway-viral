const request = require('supertest');
const app = require('../../src/app');
const InventoryItem = require('../../src/models/InventoryItem');
const InventoryQuery = require('../../src/models/InventoryQuery');
const User = require('../../src/models/User');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const {
  connectSandboxDb,
  clearSandboxDb,
  disconnectSandboxDb,
} = require('../setup/testDb');

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
    expectEnvelope(closeAgainRes, 400);
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
});


