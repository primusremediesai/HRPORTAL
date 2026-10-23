const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');

const DB_DIR = path.resolve(__dirname, '..', 'data', 'db');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let mongodInstance = null;

async function startDatabase() {
  // If external MongoDB URI is specified in .env, use it
  if (process.env.MONGODB_URI) {
    console.log(`Connecting to configured MongoDB: ${process.env.MONGODB_URI}`);
    await mongoose.connect(process.env.MONGODB_URI);
    return process.env.MONGODB_URI;
  }

  // Otherwise, run persistent embedded MongoDB stored in ./data/db
  console.log(`Starting persistent database engine at: ${DB_DIR}`);
  mongodInstance = await MongoMemoryServer.create({
    instance: {
      dbPath: DB_DIR,
      storageEngine: 'wiredTiger'
    }
  });

  const uri = mongodInstance.getUri();
  process.env.MONGODB_URI = uri;
  
  await mongoose.connect(uri);
  console.log('Database connected successfully.');

  // Seed default admin if none exists
  await seedAdmin();

  return uri;
}

async function seedAdmin() {
  try {
    const existingAdmin = await User.findOne({ email: 'admin@primus.local' });
    if (!existingAdmin) {
      const admin = new User({
        name: 'Primus HR Administrator',
        email: 'admin@primus.local',
        password: 'SuperSecurePassword123!',
        role: 'admin',
        department: 'Human Resources'
      });
      await admin.save();
      console.log('====================================================');
      console.log('Seeded Default Admin:');
      console.log('  Email:    admin@primus.local');
      console.log('  Password: SuperSecurePassword123!');
      console.log('====================================================');
    }

    // Seed default employee selfcare user if none exists
    const existingEmployee = await User.findOne({ employeeCode: 'PRI014' });
    if (!existingEmployee) {
      const empUser = new User({
        name: 'Mekala Vamsi Krishna',
        email: 'vamsi.krishna@primus.local',
        password: 'EmployeePassword123!',
        role: 'employee',
        department: 'Sales',
        employeeCode: 'PRI014'
      });
      await empUser.save();
      console.log('====================================================');
      console.log('Seeded Default Employee Selfcare User:');
      console.log('  Emp Code: PRI014 (or email: vamsi.krishna@primus.local)');
      console.log('  Password: EmployeePassword123!');
      console.log('====================================================');
    }
  } catch (err) {
    console.error('Error seeding users:', err);
  }
}

// Clean shutdown handler
async function stopDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongodInstance) {
    await mongodInstance.stop();
  }
}

module.exports = { startDatabase, stopDatabase, seedAdmin };
