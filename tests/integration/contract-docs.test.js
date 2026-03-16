const request = require('supertest');
const app = require('../../src/app');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const {
  connectSandboxDb,
  clearSandboxDb,
  disconnectSandboxDb,
} = require('../setup/testDb');

describe('Contract and documentation checks', () => {
  beforeAll(async () => {
    await connectSandboxDb();
  });

  beforeEach(async () => {
    await clearSandboxDb();
    await seedTestData();
  });

  afterAll(async () => {
    await disconnectSandboxDb();
  });

  it('DOC-001: keeps envelope format for representative success/error endpoints', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const okRes = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminLogin.token}`);
    expectEnvelope(okRes, 200);

    const errorRes = await request(app)
      .get('/api/users/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${adminLogin.token}`);
    expectEnvelope(errorRes, 404);
  });

  it('DOC-002: frontend guide key endpoints are callable', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const dashboardRes = await request(app)
      .get('/api/rotas/dashboard?week_start=2026-03-16')
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(dashboardRes, 200);

    const itemsRes = await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${managerLogin.token}`);
    expectEnvelope(itemsRes, 200);
  });

  it('DOC-003: user flow endpoint /api/users/assigned-shops/staff-summary is callable for manager', async () => {
    const managerLogin = await login('manager@org.com', 'Manager@1234');

    const res = await request(app)
      .get('/api/users/assigned-shops/staff-summary')
      .set('Authorization', `Bearer ${managerLogin.token}`);

    expectEnvelope(res, 200);
    expect(Array.isArray(res.body.data.shops)).toBe(true);
  });
});

