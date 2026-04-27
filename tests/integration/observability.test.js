const request = require('supertest');
const app = require('../../src/app');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Observability dashboard integration', () => {
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

  it('allows root to view analytics overview with request and error totals', async () => {
    const rootLogin = await login('root@org.com', 'Root@1234');

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'root@org.com', password: 'WrongPassword' });

    await request(app).get('/api/users').set('Authorization', `Bearer ${rootLogin.token}`);

    await delay(120);

    const res = await request(app)
      .get('/api/observability/overview?days=7')
      .set('Authorization', `Bearer ${rootLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.totals.requests).toBeGreaterThan(0);
    expect(res.body.data.totals.errors).toBeGreaterThan(0);
    expect(Array.isArray(res.body.data.status_breakdown)).toBe(true);
  });

  it('allows root to view error log list', async () => {
    const rootLogin = await login('root@org.com', 'Root@1234');

    await request(app).post('/api/auth/login').send({ email: 'root@org.com' });

    await delay(120);

    const res = await request(app)
      .get('/api/observability/errors?limit=20')
      .set('Authorization', `Bearer ${rootLogin.token}`);

    expectEnvelope(res, 200);
    expect(res.body.data.count).toBeGreaterThan(0);
    expect(Array.isArray(res.body.data.logs)).toBe(true);
  });

  it('blocks non-root users from observability endpoints', async () => {
    const adminLogin = await login('admin@org.com', 'Admin@1234');

    const overviewRes = await request(app)
      .get('/api/observability/overview')
      .set('Authorization', `Bearer ${adminLogin.token}`);
    expectEnvelope(overviewRes, 403);

    const errorsRes = await request(app)
      .get('/api/observability/errors')
      .set('Authorization', `Bearer ${adminLogin.token}`);
    expectEnvelope(errorsRes, 403);
  });
});
