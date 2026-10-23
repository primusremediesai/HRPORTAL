const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

/**
 * Mail delivery for ESS approvals.
 *  - SMTP configured (SMTP_HOST/SMTP_USER/SMTP_PASS in .env): messages are delivered for real.
 *  - Not configured: messages are written to ./data/outbox as JSON so the flow can be tested
 *    end-to-end locally. The result's `delivered` flag is false in that case, so the UI never
 *    claims an e-mail was sent when it was not.
 */
const OUTBOX_DIR = path.resolve(__dirname, '..', 'data', 'outbox');

let transporter = null;
function isConfigured() {
  const hasGmail = !!((process.env.GMAIL_USER || (process.env.SMTP_HOST && process.env.SMTP_HOST.includes('gmail')) || process.env.SMTP_SERVICE === 'gmail') &&
                      (process.env.GMAIL_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS));
  const hasSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  return hasGmail || hasSmtp;
}
function getTransporter() {
  if (!transporter) {
    const isGmail = !!process.env.GMAIL_USER ||
                    String(process.env.SMTP_SERVICE || '').toLowerCase() === 'gmail' ||
                    (process.env.SMTP_HOST && process.env.SMTP_HOST.includes('gmail'));

    if (isGmail) {
      const user = process.env.GMAIL_USER || process.env.SMTP_USER;
      const pass = process.env.GMAIL_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass }
      });
    } else {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
    }
  }
  return transporter;
}
function fromAddress() {
  return process.env.SMTP_FROM || process.env.GMAIL_USER || process.env.SMTP_USER || 'no-reply@primus.local';
}

async function send({ to, cc, subject, text, html, replyTo, tag }) {
  const msg = { from: fromAddress(), to, cc: cc || undefined, subject, text, html, replyTo: replyTo || undefined };
  if (!to) return { delivered: false, mode: 'skipped', reason: 'No recipient address' };

  if (isConfigured()) {
    try {
      const info = await getTransporter().sendMail(msg);
      return { delivered: true, mode: 'smtp', messageId: info.messageId };
    } catch (err) {
      console.error('[mail] SMTP send failed:', err.message);
      // fall through to outbox so the message is never lost
      const file = writeOutbox(msg, tag, 'smtp-failed: ' + err.message);
      return { delivered: false, mode: 'outbox', file, reason: err.message };
    }
  }
  const file = writeOutbox(msg, tag, 'smtp-not-configured');
  return { delivered: false, mode: 'outbox', file };
}

function writeOutbox(msg, tag, note) {
  try {
    fs.mkdirSync(OUTBOX_DIR, { recursive: true });
    const name = `${Date.now()}-${(tag || 'mail').replace(/[^a-z0-9_-]/gi, '_')}.json`;
    const file = path.join(OUTBOX_DIR, name);
    fs.writeFileSync(file, JSON.stringify({ queuedAt: new Date().toISOString(), note, ...msg }, null, 2));
    console.log(`[mail] queued in outbox (${note}): ${msg.to} — ${msg.subject}`);
    return file;
  } catch (e) {
    console.error('[mail] outbox write failed:', e.message);
    return null;
  }
}

module.exports = { send, isConfigured, OUTBOX_DIR };
