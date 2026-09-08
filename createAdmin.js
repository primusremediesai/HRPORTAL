const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');

async function setup() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const existing = await User.findOne({ email: 'admin@primus.local' });
  if (!existing) {
    const admin = new User({
      email: 'admin@primus.local',
      password: 'SuperSecurePassword123!',
      role: 'admin'
    });
    await admin.save();
    console.log('Created default admin: admin@primus.local / SuperSecurePassword123!');
  } else {
    console.log('Admin already exists.');
  }
  process.exit(0);
}

setup().catch(console.error);
