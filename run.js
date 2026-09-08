const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('./models/User');

(async () => {
  console.log('Starting In-Memory MongoDB...');
  const mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  
  process.env.MONGODB_URI = uri;
  process.env.SESSION_SECRET = 'demo_secret';
  
  await mongoose.connect(uri);
  console.log('Seeding admin user...');
  
  const admin = new User({
    email: 'admin@primus.local',
    password: 'SuperSecurePassword123!',
    role: 'admin'
  });
  await admin.save();
  console.log('Created default admin: admin@primus.local / SuperSecurePassword123!');
  
  console.log('Starting Express Server...');
  require('./server.js');
})();
