const request = require('supertest');
const app = require('../../src/app');

const login = async (email, password) => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password });

  return {
    response,
    token: response.body?.data?.token,
    user: response.body?.data?.user,
  };
};

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = {
  login,
  authHeader,
};

