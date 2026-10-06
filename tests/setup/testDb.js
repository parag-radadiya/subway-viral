const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

const connectSandboxDb = async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
  // Wait for unique indexes to be built — tests that expect duplicate-key
  // errors (409s, notification dedupe) otherwise race the background build.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
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
