const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const svc = require('../services/approvalService');
const mail = require('../services/mailService');

const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('[ess-approvals]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Employee submits a request -> server issues a 24h single-use link and e-mails the approver
router.post('/approvals/register', wrap((req) => svc.registerRequest(req.session, req.body || {})));

// In-portal decision (Approvals Centre) is mirrored so any outstanding e-mail link is voided
router.post('/approvals/:requestId/local-decision', wrap((req) => svc.localDecision(req.session, req.params.requestId, req.body || {})));

// Employee withdraws a request -> its link stops working
router.post('/approvals/:requestId/cancel', wrap((req) => svc.cancelRequest(req.session, req.params.requestId)));

// Decisions made through e-mail links that have not yet been reflected in this employee's ESS
router.get('/approvals/sync', wrap(async (req) => ({ items: await svc.pendingSync(req.session) })));
router.post('/approvals/sync/ack', wrap(async (req) => ({ acked: await svc.ackSync(req.session, (req.body || {}).items) })));

const ApprovalRequest = require('../models/ApprovalRequest');

// HR Admin Notification Feed
router.get('/approvals/admin/notifications', async (req, res) => {
  if (!req.session || !['admin', 'hr_manager'].includes(req.session.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const pending = await ApprovalRequest.find({ status: 'Pending' })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const decided = await ApprovalRequest.find({ status: { $in: ['Approved', 'Rejected'] } })
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean();

    res.json({
      success: true,
      pendingCount: pending.length,
      pending,
      recentDecisions: decided
    });
  } catch (err) {
    console.error('[admin-notifications]', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// HR Admin Quick Decide from Notification
router.post('/approvals/admin/quick-decide', wrap(async (req) => {
  const { requestId, action, remarks } = req.body || {};
  if (!['admin', 'hr_manager'].includes(req.session.role)) throw { status: 403, message: 'Forbidden' };
  return svc.localDecision(req.session, requestId, {
    action,
    remarks: remarks || `Decided by HR Admin (${req.session.email})`,
    actorName: req.session.name || 'HR Admin'
  });
}));

// Direct send email draft via Gmail / SMTP
router.post('/approvals/send-draft', wrap(async (req) => {
  const { to, cc, subject, body, html } = req.body || {};
  if (!to) throw { status: 400, message: 'Recipient email is required' };
  if (!subject) throw { status: 400, message: 'Subject is required' };
  if (!body && !html) throw { status: 400, message: 'Message body is required' };

  const result = await mail.send({
    to, cc, subject,
    text: body,
    html: html || undefined,
    tag: `draft-send-${Date.now()}`
  });

  return { ok: true, delivered: result.delivered, mode: result.mode };
}));

// Local-development helper: messages queued when SMTP is not configured (admin only)
router.get('/outbox', (req, res) => {
  if (!req.session || !['admin', 'hr_manager'].includes(req.session.role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    if (!fs.existsSync(mail.OUTBOX_DIR)) return res.json({ smtpConfigured: mail.isConfigured(), items: [] });
    const items = fs.readdirSync(mail.OUTBOX_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 50)
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(mail.OUTBOX_DIR, f), 'utf8')); } catch (e) { return null; } })
      .filter(Boolean).map(m => ({ queuedAt: m.queuedAt, to: m.to, subject: m.subject, note: m.note, text: m.text }));
    res.json({ smtpConfigured: mail.isConfigured(), items });
  } catch (e) { res.status(500).json({ error: 'Could not read outbox' }); }
});

module.exports = router;

