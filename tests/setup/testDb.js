const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

const connectSandboxDb = async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
};

const clearSandboxDb = async () => {
  const collections = mongoose.connection.collections;
  const deletionJobs = Object.values(collections).map((collection) => collection.deleteMany({}));
  await Promise.all(deletionJobs);
};

const disconnectSandboxDb = async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
};

module.exports = {
  connectSandboxDb,
  clearSandboxDb,
  disconnectSandboxDb,
};
