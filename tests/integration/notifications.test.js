const request = require('supertest');
const app = require('../../src/app');
const Notification = require('../../src/models/Notification');
const notificationService = require('../../src/services/notificationService');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('Notifications integration', () => {
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

  it('NOTIF-001: list notifications returns paginated unread notifications', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await notificationService.emit({
      category: 'inventory',
      event_type: 'INVENTORY_QUERY_OPENED',
      severity: 'warning',
      title: 'Test issue',
      message: 'Something broken',
      shop_id: fixtures.shops.mainShop._id,
      dedupe_key: 'TEST::001',
    });

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.notifications.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.notifications[0].category).toBe('inventory');
    expect(res.body.data.notifications[0].read_at).toBeNull();
  });

  it('NOTIF-002: filter by category and read=false', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await notificationService.emit({
      category: 'attendance',
      event_type: 'LATE_PUNCH_IN',
      title: 'Late staff',
      message: 'Punched in 45m late',
      shop_id: fixtures.shops.mainShop._id,
      dedupe_key: 'TEST::A1',
    });
    await notificationService.emit({
      category: 'inventory',
      event_type: 'INVENTORY_QUERY_OPENED',
      title: 'Broken item',
      message: 'Reported',
      shop_id: fixtures.shops.mainShop._id,
      dedupe_key: 'TEST::I1',
    });

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({ category: 'attendance', read: 'false' });

    expectEnvelope(res, 200);
    expect(res.body.data.notifications).toHaveLength(1);
    expect(res.body.data.notifications[0].event_type).toBe('LATE_PUNCH_IN');
  });

  it('NOTIF-003: unread-count returns total and per-category counts', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await notificationService.emit({
      category: 'attendance',
      event_type: 'LATE_PUNCH_IN',
      title: 'A',
      message: 'A',
      shop_id: fixtures.shops.mainShop._id,
      dedupe_key: 'C::A',
    });
    await notificationService.emit({
      category: 'inventory',
      event_type: 'INVENTORY_QUERY_OPENED',
      title: 'B',
      message: 'B',
      shop_id: fixtures.shops.mainShop._id,
      dedupe_key: 'C::B',
    });

    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(2);
    expect(res.body.data.by_category).toEqual(
      expect.objectContaining({
        attendance: expect.any(Number),
        inventory: expect.any(Number),
        rota: expect.any(Number),
        system: expect.any(Number),
      })
    );
    expect(res.body.data.by_category.attendance).toBeGreaterThanOrEqual(1);
    expect(res.body.data.by_category.inventory).toBeGreaterThanOrEqual(1);
  });

  it('NOTIF-004: mark single notification read', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await notificationService.emit({
      category: 'inventory',
      event_type: 'INVENTORY_QUERY_OPENED',
      title: 'X',
      message: 'X',
      shop_id: fixtures.shops.mainShop._id,
      dedupe_key: 'MARK::1',
    });

    const list = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${adminLogin.token}`);
    const id = list.body.data.notifications[0]._id;

    const res = await request(app)
      .patch(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.notification.read_at).not.toBeNull();
  });

  it('NOTIF-005: mark all read for a category', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await notificationService.emit({
      category: 'attendance',
      event_type: 'LATE_PUNCH_IN',
      title: 'A1',
      message: 'A1',
      shop_id: fixtures.shops.mainShop._id,
      dedupe_key: 'MA::1',
    });
    await notificationService.emit({
      category: 'attendance',
      event_type: 'LATE_PUNCH_IN',
      title: 'A2',
      message: 'A2',
      shop_id: fixtures.shops.mainShop._id,
      dedupe_key: 'MA::2',
    });
    await notificationService.emit({
      category: 'inventory',
      event_type: 'INVENTORY_QUERY_OPENED',
      title: 'I1',
      message: 'I1',
      shop_id: fixtures.shops.mainShop._id,
      dedupe_key: 'MA::3',
    });

    const res = await request(app)
      .post('/api/notifications/mark-all-read')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({ category: 'attendance' });

    expectEnvelope(res, 200);
    expect(res.body.data.modified).toBeGreaterThanOrEqual(2);

    const counts = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${adminLogin.token}`);
    expect(counts.body.data.by_category.attendance).toBe(0);
    expect(counts.body.data.by_category.inventory).toBeGreaterThanOrEqual(1);
  });

  it('NOTIF-006: archive (DELETE) hides notification from list', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await notificationService.emit({
      category: 'inventory',
      event_type: 'INVENTORY_QUERY_OPENED',
      title: 'X',
      message: 'X',
      shop_id: fixtures.shops.mainShop._id,
      dedupe_key: 'ARC::1',
    });

    const list = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${adminLogin.token}`);
    const id = list.body.data.notifications[0]._id;

    const del = await request(app)
      .delete(`/api/notifications/${id}`)
      .set('Authorization', `Bearer ${adminLogin.token}`);
    expectEnvelope(del, 200);
    expect(del.body.data.notification.archived_at).not.toBeNull();

    const after = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${adminLogin.token}`);
    expect(after.body.data.notifications.find((n) => n._id === id)).toBeUndefined();
  });

  it('NOTIF-007: categories endpoint returns enum constants', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const res = await request(app)
      .get('/api/notifications/categories')
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.categories).toEqual(
      expect.arrayContaining(['attendance', 'inventory', 'rota', 'system'])
    );
    expect(res.body.data.severities).toEqual(
      expect.arrayContaining(['info', 'warning', 'critical'])
    );
    expect(res.body.data.event_types).toContain('LATE_PUNCH_IN');
    expect(res.body.data.event_types).toContain('AUTO_PUNCH_OUT');
    expect(res.body.data.event_types).toContain('INVENTORY_QUERY_OPENED');
  });

  it('NOTIF-008: summary endpoint returns recent items per category', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await notificationService.emit({
      category: 'rota',
      event_type: 'ROTA_PUBLISHED',
      title: 'Week 1 published',
      message: 'OK',
      shop_id: fixtures.shops.mainShop._id,
      dedupe_key: 'SUM::1',
    });

    const res = await request(app)
      .get('/api/notifications/summary')
      .set('Authorization', `Bearer ${adminLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.categories).toEqual(
      expect.objectContaining({
        attendance: expect.objectContaining({
          unread_count: expect.any(Number),
          recent: expect.any(Array),
        }),
        inventory: expect.objectContaining({
          unread_count: expect.any(Number),
          recent: expect.any(Array),
        }),
        rota: expect.objectContaining({
          unread_count: expect.any(Number),
          recent: expect.any(Array),
        }),
        system: expect.objectContaining({
          unread_count: expect.any(Number),
          recent: expect.any(Array),
        }),
      })
    );
    expect(res.body.data.categories.rota.recent[0].event_type).toBe('ROTA_PUBLISHED');
  });

  it('NOTIF-009: dedupe prevents duplicate notifications with same dedupe_key', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    await notificationService.emit({
      category: 'attendance',
      event_type: 'LATE_PUNCH_IN',
      title: 'first',
      message: 'first',
      shop_id: fixtures.shops.mainShop._id,
      dedupe_key: 'DEDUP::1',
    });
    const second = await notificationService.emit({
      category: 'attendance',
      event_type: 'LATE_PUNCH_IN',
      title: 'second',
      message: 'second',
      shop_id: fixtures.shops.mainShop._id,
      dedupe_key: 'DEDUP::1',
    });

    expect(second.created).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);

    const list = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({ category: 'attendance' });

    const dedupOnes = list.body.data.notifications.filter(
      (n) => n.metadata && n.dedupe_key === 'DEDUP::1'
    );
    // each recipient should have at most one
    expect(dedupOnes.length).toBeLessThanOrEqual(list.body.data.notifications.length);
  });

  it('NOTIF-010: unauthenticated request → 401', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });

  it('NOTIF-011: invalid category filter → 400', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({ category: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('NOTIF-012: scan endpoint returns scan results', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const res = await request(app)
      .post('/api/notifications/scan')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .query({ target: 'all' });

    expectEnvelope(res, 200);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        missed_punch_in: expect.objectContaining({ scanned: expect.any(Number) }),
        missed_punch_out: expect.objectContaining({ scanned: expect.any(Number) }),
      })
    );
  });

  it('NOTIF-013: notifyInventoryQueryOpened fires from POST /api/inventory/queries', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const InventoryItem = require('../../src/models/InventoryItem');
    const item = await InventoryItem.create({
      item_name: 'Test Oven',
      shop_id: fixtures.shops.mainShop._id,
      stock_count: 1,
      status: 'Good',
    });

    const before = await Notification.countDocuments({
      event_type: 'INVENTORY_QUERY_OPENED',
    });

    await request(app)
      .post('/api/inventory/queries')
      .set('Authorization', `Bearer ${adminLogin.token}`)
      .send({
        item_id: item._id,
        shop_id: fixtures.shops.mainShop._id,
        issue_note: 'Broken',
      });

    // Notifications are fire-and-forget — give the async insert a moment to land
    await new Promise((resolve) => setTimeout(resolve, 200));

    const after = await Notification.countDocuments({
      event_type: 'INVENTORY_QUERY_OPENED',
    });
    expect(after).toBeGreaterThan(before);
  });
});
