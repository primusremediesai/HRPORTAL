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
    const identifier = email.trim();
    const user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { employeeCode: identifier.toUpperCase() }
      ]
    });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.isLocked) {
      return res.status(403).json({ error: 'Account temporarily locked due to failed attempts. Please try again in 15 minutes.' });
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

    // Reset attempts on successful login
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    user.lastLogin = new Date();
    await user.save();

    req.session.userId = user._id;
    req.session.role = user.role;
    req.session.email = user.email;
    req.session.name = user.name;
    req.session.employeeCode = user.employeeCode;

    await AuditLog.create({
      action: 'LOGIN',
      userId: user._id,
      ip: req.ip,
      details: `Successful login as ${user.role} (${user.employeeCode || user.email})`
    });

    res.json({
      success: true,
      message: 'Logged in successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        employeeCode: user.employeeCode
      }
    });
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
    res.json({ success: true, message: 'Logged out successfully' });
  });
};

exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (err) {
    console.error('Fetch me error:', err);
    res.status(500).json({ error: 'Failed to fetch current user' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    const user = await User.findById(req.session.userId);
    const isMatch = await user.verifyPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect current password' });
    }

    user.password = newPassword;
    await user.save();

    await AuditLog.create({
      action: 'PASSWORD_CHANGE',
      userId: user._id,
      ip: req.ip,
      details: 'Password updated successfully'
    });

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to update password' });
  }
};

exports.registerUser = async (req, res) => {
  try {
    const { email, password, role = 'employee', name, department, employeeCode } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }

    const newUser = new User({
      email,
      password,
      role,
      name: name || 'Team Member',
      department: department || 'General',
      employeeCode
    });

    await newUser.save();

    await AuditLog.create({
      action: 'USER_REGISTER',
      userId: req.session.userId,
      ip: req.ip,
      details: `Registered user ${email} with role ${role}`
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role
      }
    });
  } catch (err) {
    console.error('Register user error:', err);
    res.status(500).json({ error: err.message || 'Failed to create user' });
  }
};
