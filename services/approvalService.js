const crypto = require('crypto');
const ApprovalRequest = require('../models/ApprovalRequest');
const ApprovalToken = require('../models/ApprovalToken');
const User = require('../models/User');
const mail = require('./mailService');

const LINK_TTL_HOURS = 24;
const LINK_TTL_MS = LINK_TTL_HOURS * 60 * 60 * 1000;
const KIND_LABEL = { leave: 'Leave request', expense: 'Expense claim', correction: 'Attendance correction' };
const ROLE_LABEL = { manager: 'Reporting Manager', hr: 'HR', finance: 'Finance' };
const isHR = (session) => ['admin', 'hr_manager'].includes(session && session.role);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const baseUrl = () => (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clean = (v, max = 300) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const normEmail = (v) => clean(v, 200).toLowerCase();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDateTime = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST';

/* ---------- recipient resolution ---------- */
async function adminEmail() {
  const a = await User.findOne({ role: 'admin' }).select('email').lean();
  return a ? a.email : '';
}
async function resolveApproverEmail(stage) {
  if (stage.approverEmail && EMAIL_RE.test(stage.approverEmail)) return normEmail(stage.approverEmail);
  if (stage.role === 'manager' && stage.approverCode) {
    const u = await User.findOne({ employeeCode: stage.approverCode.toUpperCase() }).select('email').lean();
    if (u && u.email) return normEmail(u.email);
    return ''; // unknown — approver supplies their address on the approval page
  }
  if (stage.role === 'finance' && process.env.FINANCE_EMAIL) return normEmail(process.env.FINANCE_EMAIL);
  if (process.env.HR_EMAIL) return normEmail(process.env.HR_EMAIL);
  return normEmail(await adminEmail());
}
async function resolveEmployeeEmail(code, fallback) {
  const u = await User.findOne({ employeeCode: String(code).toUpperCase() }).select('email').lean();
  if (u && u.email) return normEmail(u.email);
  return EMAIL_RE.test(fallback || '') ? normEmail(fallback) : '';
}

/* ---------- tokens ---------- */
async function issueToken(request, stageIndex) {
  await ApprovalToken.updateMany({ requestId: request.requestId, status: 'active' }, { status: 'revoked' });
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  await ApprovalToken.create({
    tokenHash: sha256(token), requestId: request.requestId, stageIndex,
    approverEmail: request.stages[stageIndex].approverEmail || '', expiresAt
  });
  return { token, expiresAt, link: `${baseUrl()}/approve/${token}` };
}
const revokeTokens = (requestId) => ApprovalToken.updateMany({ requestId, status: 'active' }, { status: 'revoked' });

/* ---------- e-mail composition ---------- */
function approvalEmail(request, stageIndex, link, expiresAt, { maskLink = false } = {}) {
  const stage = request.stages[stageIndex];
  const label = KIND_LABEL[request.kind];
  const greet = stage.approverName || ROLE_LABEL[stage.role];
  const lines = (request.lines || []).map(l => `${l.label.padEnd(16)}: ${l.value}`).join('\n');
  const linkText = maskLink ? '[Secure approval link — sent directly to the approver]' : link;
  const subject = `Action required: ${label} ${request.requestId} — ${request.employeeName} (${request.employeeCode})`;
  const text = `Dear ${greet},\n\n${request.employeeName} (${request.employeeCode}) has submitted a ${label.toLowerCase()} that needs your decision.\n\n` +
    `Reference       : ${request.requestId}\n${lines}\n\n` +
    `Review and Approve / Reject here (no login required):\n${linkText}\n\n` +
    `This secure link is valid for ${LINK_TTL_HOURS} hours (until ${fmtDateTime(expiresAt)}) and can be used only once. ` +
    `Please do not forward it — anyone holding the link can act on this request.\n\n` +
    `Regards,\nPrimus HR Portal (automated message)`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;color:#0f172a">
    <p>Dear ${esc(greet)},</p>
    <p><strong>${esc(request.employeeName)}</strong> (${esc(request.employeeCode)}) has submitted a ${esc(label.toLowerCase())} that needs your decision.</p>
    <table style="border-collapse:collapse;font-size:14px;margin:12px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Reference</td><td><strong>${esc(request.requestId)}</strong></td></tr>
      ${(request.lines || []).map(l => `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${esc(l.label)}</td><td>${esc(l.value)}</td></tr>`).join('')}
    </table>
    ${maskLink ? '' : `<p><a href="${esc(link)}" style="background:#0e4a36;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Review &amp; Approve / Reject</a></p>
    <p style="font-size:12px;color:#64748b;word-break:break-all">${esc(link)}</p>`}
    <p style="font-size:12px;color:#64748b">This secure link is valid for ${LINK_TTL_HOURS} hours (until ${esc(fmtDateTime(expiresAt))}) and can be used only once. Do not forward it.</p>
  </div>`;
  return { subject, text, html };
}

function decisionEmailToEmployee(request, d, nextStage) {
  const label = KIND_LABEL[request.kind] || 'Request';
  const verb = d.action === 'approve' ? 'approved' : d.action === 'reject' ? 'rejected' : 'returned for correction';
  const approverEmail = d.actorEmail || 'Approver';
  let progress = '';
  if (d.action === 'approve') progress = nextStage ? `\nNext step: your request is now pending ${ROLE_LABEL[nextStage.role] || nextStage.role} approval.\n` : `\nYour request is now fully approved.\n`;
  const subject = `${label} ${request.requestId} — ${verb.charAt(0).toUpperCase() + verb.slice(1)} by ${approverEmail}`;
  const text = `Dear ${request.employeeName},\n\nYour ${label.toLowerCase()} ${request.requestId} has been ${verb} by ${approverEmail}.\n\n` +
    `--------------------------------------------------\n` +
    `Confirmed By (Email Address) : ${approverEmail}\n` +
    `Decision                     : ${verb.toUpperCase()}\n` +
    `Decision Time                : ${fmtDateTime(d.at)}\n` +
    `Approval Method              : ${d.via === 'email-link' ? 'Secure 24h E-mail Approval Link' : 'ESS Portal'}\n` +
    (d.remarks ? `Approver Remarks             : ${d.remarks}\n` : '') +
    `--------------------------------------------------\n` +
    progress +
    `\nThe update is reflected in your Primus ESS portal.\n\nRegards,\nPrimus HR Portal (automated notification)`;

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:580px;color:#0f172a;line-height:1.5;">
    <div style="background:#0e4a36;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;">
      <h2 style="margin:0;font-size:18px;">${esc(label)} ${esc(verb.toUpperCase())}</h2>
      <div style="font-size:12px;opacity:0.85;margin-top:4px;">Request ID: ${esc(request.requestId)}</div>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:none;padding:20px;border-radius:0 0 10px 10px;background:#fff;">
      <p>Dear <strong>${esc(request.employeeName)}</strong>,</p>
      <p>Your ${esc(label.toLowerCase())} has been <strong>${esc(verb)}</strong> by <strong>${esc(approverEmail)}</strong>.</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:6px 0;color:#64748b;width:40%;">Confirmed By Email</td><td><strong style="color:#0e8a5f;">${esc(approverEmail)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Decision</td><td><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700;background:${d.action === 'approve' ? '#ecfdf5;color:#065f46;' : '#fef2f2;color:#991b1b;'}">${esc(verb.toUpperCase())}</span></td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Decision Time</td><td>${esc(fmtDateTime(d.at))}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Approval Method</td><td>${esc(d.via === 'email-link' ? '24-Hour Approval Link' : 'ESS Portal')}</td></tr>
          ${d.remarks ? `<tr><td style="padding:6px 0;color:#64748b;">Remarks</td><td>${esc(d.remarks)}</td></tr>` : ''}
        </table>
      </div>
      ${progress ? `<p style="font-size:13px;color:#0284c7;background:#f0f9ff;padding:10px;border-radius:6px;">ℹ️ ${esc(progress.trim())}</p>` : ''}
      <p style="font-size:13px;color:#64748b;margin-top:16px;">This update is immediately reflected in your Primus Employee Self-Service (ESS) dashboard.</p>
    </div>
  </div>`;
  return { subject, text, html };
}
function decisionReceiptToApprover(request, d) {
  const label = KIND_LABEL[request.kind];
  const verb = d.action === 'approve' ? 'approved' : d.action === 'reject' ? 'rejected' : 'returned';
  return {
    subject: `Recorded: you ${verb} ${label.toLowerCase()} ${request.requestId}`,
    text: `Your decision has been recorded.\n\nRequest   : ${request.requestId} — ${request.employeeName} (${request.employeeCode})\nDecision  : ${verb}\nFrom e-mail: ${d.actorEmail}\nTime      : ${fmtDateTime(d.at)}\n` +
      (d.remarks ? `Remarks   : ${d.remarks}\n` : '') + `\nThe approval link used has now expired. If this was not you, contact HR immediately.\n\nPrimus HR Portal (automated message)`
  };
}

async function sendApprovalLinkMail(request, stageIndex, tokenInfo) {
  const stage = request.stages[stageIndex];
  const m = approvalEmail(request, stageIndex, tokenInfo.link, tokenInfo.expiresAt);
  const res = await mail.send({ to: stage.approverEmail, subject: m.subject, text: m.text, html: m.html, tag: `approval-${request.requestId}-s${stageIndex}` });
  return { ...res, message: m };
}

/* ---------- register ---------- */
async function registerRequest(session, body) {
  const requestId = clean(body.requestId, 64);
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(requestId)) throw httpErr(400, 'Invalid request id');
  if (!KIND_LABEL[body.kind]) throw httpErr(400, 'Invalid request kind');
  const emp = body.employee || {};
  const employeeCode = clean(emp.code, 20).toUpperCase();
  if (!employeeCode) throw httpErr(400, 'Employee code required');
  if (!isHR(session) && String(session.employeeCode || '').toUpperCase() !== employeeCode) {
    throw httpErr(403, 'You can only submit requests for yourself');
  }
  if (!Array.isArray(body.stages) || !body.stages.length || body.stages.length > 4) throw httpErr(400, 'Invalid approval stages');
  const stages = body.stages.map(s => {
    const role = String(s.role || '').toLowerCase();
    if (!ROLE_LABEL[role]) throw httpErr(400, 'Invalid stage role');
    return {
      role, approverCode: clean(s.approverCode, 20).toUpperCase(), approverName: clean(s.approverName, 120),
      approverEmail: EMAIL_RE.test(s.approverEmail || '') ? normEmail(s.approverEmail) : '',
      state: String(s.state || '').toLowerCase() === 'skipped' ? 'skipped' : 'pending'
    };
  });
  const clientCurrent = stages.findIndex(s => s.state === 'pending');
  if (clientCurrent < 0) throw httpErr(400, 'No pending approval stage');
  for (const s of stages) if (s.state === 'pending') s.approverEmail = await resolveApproverEmail(s);

  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 14)
    .map(l => ({ label: clean(l.label, 40), value: clean(l.value, 400) })).filter(l => l.label);
  const employeeEmail = await resolveEmployeeEmail(employeeCode, emp.email);

  let reqDoc = await ApprovalRequest.findOne({ requestId });
  if (reqDoc) {
    if (reqDoc.employeeCode !== employeeCode) throw httpErr(403, 'Request belongs to another employee');
    if (['Approved', 'Rejected', 'Cancelled'].includes(reqDoc.status)) throw httpErr(409, `Request already ${reqDoc.status.toLowerCase()}`);
    if (reqDoc.status === 'Pending' && reqDoc.currentStage !== clientCurrent) {
      return { ok: true, serverAhead: true, status: reqDoc.status };
    }
    // Pending at the same stage (re-issue link) or Returned (resubmission) -> reset
    reqDoc.stages = stages; reqDoc.currentStage = clientCurrent; reqDoc.status = 'Pending';
    reqDoc.title = clean(body.title, 200); reqDoc.lines = lines; reqDoc.employeeName = clean(emp.name, 120) || reqDoc.employeeName;
    reqDoc.employeeEmail = employeeEmail || reqDoc.employeeEmail;
  } else {
    reqDoc = new ApprovalRequest({
      requestId, kind: body.kind, employeeCode, employeeName: clean(emp.name, 120), employeeEmail,
      title: clean(body.title, 200), lines, stages, currentStage: clientCurrent, status: 'Pending', createdBy: session.userId
    });
  }
  await reqDoc.save();

  const tokenInfo = await issueToken(reqDoc, clientCurrent);
  const stage = reqDoc.stages[clientCurrent];
  const sent = await sendApprovalLinkMail(reqDoc, clientCurrent, tokenInfo);
  // If the server really delivered the message, the employee's draft must NOT expose the secret link.
  const draft = sent.delivered
    ? approvalEmail(reqDoc, clientCurrent, tokenInfo.link, tokenInfo.expiresAt, { maskLink: true })
    : sent.message;
  return {
    ok: true, stageIndex: clientCurrent, role: stage.role, to: stage.approverEmail,
    subject: draft.subject, body: draft.text, link: sent.delivered ? undefined : tokenInfo.link,
    delivered: !!sent.delivered, mode: sent.mode,
    expiresAt: tokenInfo.expiresAt, ttlHours: LINK_TTL_HOURS, needsRecipient: !stage.approverEmail
  };
}

/* ---------- apply a decision (shared by link + local) ---------- */
async function applyDecision(reqDoc, stageIndex, { action, actorEmail, actorName, remarks, via, ip }) {
  const stage = reqDoc.stages[stageIndex];
  const now = new Date();
  stage.state = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'returned';
  stage.actorEmail = actorEmail; stage.actorName = actorName || stage.approverName || '';
  stage.remarks = remarks; stage.at = now; stage.via = via;
  let next = -1;
  if (action === 'approve') {
    next = reqDoc.stages.findIndex((s, i) => i > stageIndex && s.state === 'pending');
    if (next >= 0) { reqDoc.currentStage = next; reqDoc.status = 'Pending'; }
    else { reqDoc.currentStage = null; reqDoc.status = 'Approved'; }
  } else { reqDoc.currentStage = null; reqDoc.status = action === 'reject' ? 'Rejected' : 'Returned'; }
  const d = {
    seq: reqDoc.decisions.length + 1, stageIndex, role: stage.role, action, actorEmail,
    actorName: stage.actorName, remarks, at: now, via, applied: via === 'ess-portal'
  };
  reqDoc.decisions.push(d);
  await reqDoc.save();

  const notices = [];
  let nextSend = null; let nextTokenInfo = null;
  // next approver gets their own fresh 24h link
  if (next >= 0) {
    const ns = reqDoc.stages[next];
    if (!ns.approverEmail) { ns.approverEmail = await resolveApproverEmail(ns); await reqDoc.save(); }
    nextTokenInfo = await issueToken(reqDoc, next);
    nextSend = sendApprovalLinkMail(reqDoc, next, nextTokenInfo);
    notices.push(nextSend);
  } else {
    await revokeTokens(reqDoc.requestId);
  }
  // automatic confirmation e-mails (employee + approver receipt)
  const nextStage = next >= 0 ? reqDoc.stages[next] : null;
  const empEmail = reqDoc.employeeEmail || (await resolveEmployeeEmail(reqDoc.employeeCode));
  if (empEmail) {
    const m = decisionEmailToEmployee(reqDoc, d, nextStage);
    notices.push(mail.send({ to: empEmail, subject: m.subject, text: m.text, html: m.html, tag: `decision-${reqDoc.requestId}` }));
  }
  if (actorEmail) {
    const m = decisionReceiptToApprover(reqDoc, d);
    notices.push(mail.send({ to: actorEmail, subject: m.subject, text: m.text, tag: `receipt-${reqDoc.requestId}` }));
  }
  await Promise.allSettled(notices);
  let nextDraft = null;
  if (nextSend) {
    const sent = await nextSend.catch(() => null);
    if (sent) {
      const m = sent.delivered ? approvalEmail(reqDoc, next, nextTokenInfo.link, nextTokenInfo.expiresAt, { maskLink: true }) : sent.message;
      nextDraft = { to: reqDoc.stages[next].approverEmail, subject: m.subject, body: m.text, delivered: !!sent.delivered, mode: sent.mode, expiresAt: nextTokenInfo.expiresAt, role: reqDoc.stages[next].role };
    }
  }
  return { decision: d, status: reqDoc.status, nextRole: nextStage ? nextStage.role : null, nextDraft };
}

/* ---------- decision through the e-mailed link ---------- */
async function lookupToken(token) {
  const tok = await ApprovalToken.findOne({ tokenHash: sha256(String(token || '')) });
  if (!tok) return { error: 'invalid' };
  if (tok.status === 'used') return { error: 'used', tok };
  if (tok.status === 'revoked') return { error: 'revoked', tok };
  if (tok.expiresAt <= new Date()) return { error: 'expired', tok };
  const reqDoc = await ApprovalRequest.findOne({ requestId: tok.requestId });
  if (!reqDoc) return { error: 'invalid' };
  const stage = reqDoc.stages[tok.stageIndex];
  if (reqDoc.status !== 'Pending' || reqDoc.currentStage !== tok.stageIndex || !stage || stage.state !== 'pending') {
    return { error: 'stale', tok, reqDoc };
  }
  return { tok, reqDoc, stage };
}

async function decideByToken(token, { action, remarks, email, ip }) {
  const found = await lookupToken(token);
  if (found.error) return { ok: false, code: found.error };
  const { tok, reqDoc, stage } = found;
  if (!['approve', 'reject'].includes(action)) return { ok: false, code: 'bad_action' };
  remarks = clean(remarks, 1000);
  if (action === 'reject' && remarks.length < 3) return { ok: false, code: 'remarks_required' };
  const e = normEmail(email);
  if (tok.approverEmail) {
    if (e !== tok.approverEmail.toLowerCase()) return { ok: false, code: 'email_mismatch' };
  } else if (!EMAIL_RE.test(e)) return { ok: false, code: 'email_required' };
  if (reqDoc.employeeEmail && e === reqDoc.employeeEmail.toLowerCase()) return { ok: false, code: 'self_approval' };

  // atomic single-use consumption — a second click / concurrent request loses the race
  const consumed = await ApprovalToken.findOneAndUpdate(
    { _id: tok._id, status: 'active', expiresAt: { $gt: new Date() } },
    { status: 'used', usedAt: new Date(), usedFromIp: ip || '' }, { new: true });
  if (!consumed) return { ok: false, code: 'used' };

  const out = await applyDecision(reqDoc, tok.stageIndex, { action, actorEmail: e, actorName: stage.approverName, remarks, via: 'email-link', ip });
  return { ok: true, status: out.status, action, nextRole: out.nextRole };
}

/* ---------- decision reported from the in-portal Approvals Centre ---------- */
async function localDecision(session, requestId, body) {
  const reqDoc = await ApprovalRequest.findOne({ requestId: clean(requestId, 64) });
  if (!reqDoc) return { ok: true, tracked: false };
  if (!isHR(session) && String(session.employeeCode || '').toUpperCase() === reqDoc.employeeCode) throw httpErr(403, 'You cannot decide your own request');
  const idx = body.stageIndex == null ? reqDoc.currentStage : Number(body.stageIndex);
  if (reqDoc.status !== 'Pending' || idx == null || idx !== reqDoc.currentStage || reqDoc.stages[idx].state !== 'pending') return { ok: true, tracked: true, stale: true, status: reqDoc.status };
  if (!['approve', 'reject', 'return'].includes(body.action)) throw httpErr(400, 'Invalid action');
  const out = await applyDecision(reqDoc, idx, {
    action: body.action, actorEmail: normEmail(session.email), actorName: clean(body.actorName || session.name, 120),
    remarks: clean(body.remarks, 1000), via: 'ess-portal'
  });
  return { ok: true, tracked: true, status: out.status, nextDraft: out.nextDraft };
}

async function cancelRequest(session, requestId) {
  const reqDoc = await ApprovalRequest.findOne({ requestId: clean(requestId, 64) });
  if (!reqDoc) return { ok: true, tracked: false };
  if (!isHR(session) && String(session.employeeCode || '').toUpperCase() !== reqDoc.employeeCode) throw httpErr(403, 'Only the requester can cancel');
  reqDoc.status = 'Cancelled'; reqDoc.currentStage = null; await reqDoc.save();
  await revokeTokens(reqDoc.requestId);
  return { ok: true, tracked: true };
}

/* ---------- sync decisions made via links into the employee's ESS ---------- */
async function pendingSync(session) {
  const filter = isHR(session) ? {} : { employeeCode: String(session.employeeCode || '').toUpperCase() };
  const docs = await ApprovalRequest.find({ ...filter, 'decisions.applied': false }).lean();
  return docs.map(r => ({
    requestId: r.requestId, kind: r.kind, employeeCode: r.employeeCode, status: r.status,
    decisions: r.decisions.filter(d => !d.applied)
  }));
}
async function ackSync(session, items) {
  let n = 0;
  for (const it of (Array.isArray(items) ? items : []).slice(0, 100)) {
    const doc = await ApprovalRequest.findOne({ requestId: clean(it.requestId, 64) });
    if (!doc) continue;
    if (!isHR(session) && doc.employeeCode !== String(session.employeeCode || '').toUpperCase()) continue;
    const d = doc.decisions.find(x => x.seq === Number(it.seq));
    if (d && !d.applied) { d.applied = true; n++; await doc.save(); }
  }
  return n;
}

function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = {
  registerRequest, lookupToken, decideByToken, localDecision, cancelRequest, pendingSync, ackSync,
  KIND_LABEL, ROLE_LABEL, LINK_TTL_HOURS, esc, fmtDateTime
};
