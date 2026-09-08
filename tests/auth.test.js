const request = require('supertest');
const mongoose = require('mongoose');
const express = require('express');
const authRoutes = require('../routes/auth');
const User = require('../models/User');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('Authentication Security Tests', () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_db');
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  it('should prevent NoSQL injection on login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: { $gt: "" }, password: "password" });
    
    expect(res.statusCode).not.toBe(200);
  });

  it('should lock account after multiple failed attempts (brute force protection)', async () => {
    const email = 'test_lockout@example.com';
    const user = new User({ email, password: 'password', role: 'admin' });
    await user.save();

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'wrongpassword' });
    }

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'wrongpassword' });

    expect(res.statusCode).toBe(403); // Locked
    expect(res.body.error).toMatch(/temporarily locked/);
  });

  it('should enforce role-based access control (RBAC)', async () => {
    // Note: Assuming a protected route exists for testing RBAC
    const { requireAdmin } = require('../middleware/authMiddleware');
    const testApp = express();
    testApp.use(express.json());
    testApp.get('/admin-only', 
      (req, res, next) => { req.session = { role: 'user' }; next(); },
      requireAdmin, 
      (req, res) => res.status(200).send('OK')
    );

    const res = await request(testApp).get('/admin-only');
    expect(res.statusCode).toBe(403); // Forbidden
  });
});
