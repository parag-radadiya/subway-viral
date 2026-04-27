const request = require('supertest');
const app = require('../../src/app');
const { expectEnvelope } = require('../helpers/assertions');
const { login } = require('../helpers/auth');
const { seedTestData } = require('../helpers/seedTestData');
const { connectSandboxDb, clearSandboxDb, disconnectSandboxDb } = require('../setup/testDb');

describe('Roles module integration', () => {
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

  it('ROLE-001 and ROLE-002: allows role list for root and blocks non-privileged user', async () => {
    const rootLogin = await login('root@org.com', 'Root@1234');
    const staffLogin = await login('staff@org.com', 'Staff@1234');

    const okRes = await request(app)
      .get('/api/roles')
      .set('Authorization', `Bearer ${rootLogin.token}`);
    expectEnvelope(okRes, 200);
    expect(Array.isArray(okRes.body.data.roles)).toBe(true);

    const blockedRes = await request(app)
      .get('/api/roles')
      .set('Authorization', `Bearer ${staffLogin.token}`);
    expectEnvelope(blockedRes, 403);
  });

  it('ROLE-003, ROLE-004, ROLE-005: creates, updates, and deletes a role', async () => {
    const rootLogin = await login('root@org.com', 'Root@1234');

    const createRes = await request(app)
      .post('/api/roles')
      .set('Authorization', `Bearer ${rootLogin.token}`)
      .send({
        role_name: 'QA Role',
        permissions: {
          can_view_all_staff: true,
          can_manage_inventory: false,
        },
      });
    expectEnvelope(createRes, 201);

    const roleId = createRes.body.data.role._id;

    const updateRes = await request(app)
      .put(`/api/roles/${roleId}`)
      .set('Authorization', `Bearer ${rootLogin.token}`)
      .send({ role_name: 'QA Role Updated' });
    expectEnvelope(updateRes, 200);

    const deleteRes = await request(app)
      .delete(`/api/roles/${roleId}`)
      .set('Authorization', `Bearer ${rootLogin.token}`);
    expectEnvelope(deleteRes, 200);
  });

  it('ROLE-006: returns not found for missing role id on get/update/delete', async () => {
    const rootLogin = await login('root@org.com', 'Root@1234');
    const missingId = '507f1f77bcf86cd799439011';

    const getRes = await request(app)
      .get(`/api/roles/${missingId}`)
      .set('Authorization', `Bearer ${rootLogin.token}`);
    expectEnvelope(getRes, 404);

    const updateRes = await request(app)
      .put(`/api/roles/${missingId}`)
      .set('Authorization', `Bearer ${rootLogin.token}`)
      .send({ role_name: 'Missing' });
    expectEnvelope(updateRes, 404);

    const deleteRes = await request(app)
      .delete(`/api/roles/${missingId}`)
      .set('Authorization', `Bearer ${rootLogin.token}`);
    expectEnvelope(deleteRes, 404);
  });
});
