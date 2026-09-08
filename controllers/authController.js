const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15 mins

exports.login = async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.isLocked) {
      return res.status(403).json({ error: 'Account temporarily locked. Please try again later.' });
    }

    const isMatch = await user.verifyPassword(password);
    
    if (!isMatch) {
      user.loginAttempts += 1;
      if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        user.lockUntil = Date.now() + LOCK_TIME;
      }
      await user.save();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.loginAttempts > 0) {
      user.loginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();
    }

    req.session.userId = user._id;
    req.session.role = user.role;

    await AuditLog.create({
      action: 'LOGIN',
      userId: user._id,
      ip: req.ip,
      details: 'Successful login'
    });

    res.json({ success: true, message: 'Logged in successfully' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.logout = async (req, res) => {
  if (req.session && req.session.userId) {
    await AuditLog.create({
      action: 'LOGOUT',
      userId: req.session.userId,
      ip: req.ip,
      details: 'User logged out'
    });
  }
  
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
};
