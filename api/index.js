const app = require('../src/app');
const connectDB = require('../src/config/db');

let isDbReady = false;

module.exports = async (req, res) => {
  try {
    if (!isDbReady) {
      await connectDB();
      isDbReady = true;
    }
    return app(req, res);
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: 'Failed to initialize server',
      data: {},
    });
  }
};
