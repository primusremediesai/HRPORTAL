const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').MongoStore;
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const path = require('path');

const authRoutes = require('./routes/auth');
const fileRoutes = require('./routes/files');
const publicApprovalRoutes = require('./routes/publicApproval');
const essApprovalRoutes = require('./routes/essApprovals');
const hrDocumentRoutes = require('./routes/hrDocuments');
const { requireAuth } = require('./middleware/authMiddleware');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));

app.use(express.json());
app.use((req, res, next) => { 
  if (req.body) req.body = mongoSanitize.sanitize(req.body); 
  if (req.params) req.params = mongoSanitize.sanitize(req.params); 
  next(); 
});
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate limit for authentication
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: 'Too many requests' });
app.use('/api', limiter);

// Session storage configured to persistent MongoDB
app.use(session({
  secret: process.env.SESSION_SECRET || 'primus_session_secret_default',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ 
    clientPromise: mongoose.connection.asPromise().then(() => mongoose.connection.getClient())
  }),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// Public Auth & Static assets
app.use('/api/auth', authRoutes);

app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

app.get('/login.html', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/index.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Public, token-secured approver pages (no login — the one-time 24h link is the credential)
app.use(publicApprovalRoutes);

// Protected routes (File storage & Management)
app.use('/api/files', requireAuth, fileRoutes);
app.use('/api/ess', requireAuth, essApprovalRoutes);
app.use('/api/hr-docs', requireAuth, hrDocumentRoutes);

// Protected HTML pages
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}
