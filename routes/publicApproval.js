const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const svc = require('../services/approvalService');
const { esc, fmtDateTime, KIND_LABEL, ROLE_LABEL, LINK_TTL_HOURS } = svc;

/**
 * Public (no login) pages used by approvers who follow the e-mailed link.
 * GET never consumes a token (so mail scanners / link previews can't burn it);
 * only the explicit POST decision does.
 */
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please try again later.' } });

const secureHeaders = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  next();
};

const MESSAGES = {
  invalid: ['Link not recognised', 'This approval link is not valid. Please use the link from your most recent request e-mail.'],
  expired: ['Link expired', `For security, approval links are valid for ${LINK_TTL_HOURS} hours. This link has expired — ask the employee to resubmit, or review the request in the ESS portal.`],
  used: ['Already actioned', 'This link has already been used. A decision has been recorded for this request.'],
  revoked: ['Link no longer active', 'This link has been replaced or withdrawn (the request may have been cancelled or already decided).'],
  stale: ['Request already decided', 'This request is no longer awaiting your decision.']
};

const page = (title, inner) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} — Primus HR Approval</title><style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,'Segoe UI',Arial,sans-serif;background:linear-gradient(160deg,#ecfdf5,#f1f5f9);color:#0f172a;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:28px 14px}
.card{background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,.10);max-width:560px;width:100%;overflow:hidden}
.head{background:#0e4a36;color:#fff;padding:18px 24px}.head small{opacity:.8;letter-spacing:.6px;text-transform:uppercase;font-size:11px}.head h1{margin:4px 0 0;font-size:19px}
.body{padding:22px 24px}table{width:100%;border-collapse:collapse;font-size:14px;margin:6px 0 16px}td{padding:7px 0;border-bottom:1px solid #f1f5f9;vertical-align:top}td:first-child{color:#64748b;width:38%}
label{display:block;font-size:12px;font-weight:600;color:#475569;margin:12px 0 5px}input,textarea{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;font-size:14px}
input[readonly]{background:#f8fafc;color:#334155}textarea{min-height:76px;resize:vertical}
.row{display:flex;gap:10px;margin-top:18px}.btn{flex:1;border:0;border-radius:9px;padding:12px;font-weight:700;font-size:14px;cursor:pointer;color:#fff}
.ok{background:#0e8a5f}.no{background:#c0392b}.btn:disabled{opacity:.5;cursor:wait}.note{font-size:12px;color:#64748b;margin-top:14px;line-height:1.5}
.msg{padding:12px 14px;border-radius:9px;font-size:14px;margin-top:14px}.err{background:#fef2f2;color:#991b1b}.good{background:#ecfdf5;color:#065f46}
</style></head><body><div class="card"><div class="head"><small>Primus Remedies · HR Portal</small><h1>${esc(title)}</h1></div><div class="body">${inner}</div></div></body></html>`;

router.get('/approve/:token', limiter, secureHeaders, async (req, res) => {
  const found = await svc.lookupToken(req.params.token);
  if (found.error) {
    const [t, m] = MESSAGES[found.error] || MESSAGES.invalid;
    return res.status(found.error === 'invalid' ? 404 : 410).send(page(t, `<p>${esc(m)}</p>`));
  }
  const { reqDoc, tok, stage } = found;
  const label = KIND_LABEL[reqDoc.kind];
  const rows = [['Reference', reqDoc.requestId], ['Employee', `${reqDoc.employeeName} (${reqDoc.employeeCode})`], ...reqDoc.lines.map(l => [l.label, l.value])]
    .map(([a, b]) => `<tr><td>${esc(a)}</td><td><strong>${esc(b)}</strong></td></tr>`).join('');
  const known = !!tok.approverEmail;
  res.send(page(`${label} — your decision`, `
<p style="margin:0 0 6px">You are approving as <strong>${esc(stage.approverName || ROLE_LABEL[stage.role])}</strong> (${esc(ROLE_LABEL[stage.role])}).</p>
<table>${rows}</table>
<form id="f" autocomplete="off">
  <label for="email">Your e-mail address ${known ? '(verified recipient)' : '(required — recorded with your decision)'}</label>
  <input id="email" type="email" required ${known ? `value="${esc(tok.approverEmail)}" readonly` : 'placeholder="you@company.com"'}>
  <label for="remarks">Remarks <span style="font-weight:400">(required if rejecting)</span></label>
  <textarea id="remarks" maxlength="1000" placeholder="Optional comment for the employee"></textarea>
  <div class="row"><button type="button" class="btn ok" id="bA">✓ Approve</button><button type="button" class="btn no" id="bR">✕ Reject</button></div>
</form>
<div id="out"></div>
<p class="note">This link expires ${esc(fmtDateTime(tok.expiresAt))} and works once. The employee will be notified automatically by e-mail, and the decision appears in their ESS portal.</p>
<script>
(function(){
  var out=document.getElementById('out'),bA=document.getElementById('bA'),bR=document.getElementById('bR');
  var T=${JSON.stringify(req.params.token)};
  var ERR={email_mismatch:'That e-mail does not match the address this link was sent to.',email_required:'Please enter a valid e-mail address.',self_approval:'You cannot decide your own request.',remarks_required:'Please enter remarks (at least 3 characters) when rejecting.',used:'This link has already been used.',expired:'This link has expired.',revoked:'This link is no longer active.',stale:'This request has already been decided.',invalid:'This link is not valid.',bad_action:'Invalid action.'};
  function go(a){
    var em=document.getElementById('email').value.trim();
    if(!em){out.innerHTML='<div class="msg err">Please enter your e-mail address.</div>';return}
    bA.disabled=bR.disabled=true;
    fetch('/api/approvals/public/'+encodeURIComponent(T)+'/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:a,email:em,remarks:document.getElementById('remarks').value})})
    .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
    .then(function(x){
      if(x.j&&x.j.ok){
        document.getElementById('f').style.display='none';
        var m=a==='approve'?'Approved':'Rejected';
        out.innerHTML='<div class="msg good"><strong>'+m+' — recorded.</strong><br>'+(x.j.nextRole?'The request has been forwarded to the next approver. ':'')+'The employee has been notified automatically, and a confirmation has been sent to '+em.replace(/[<>&"]/g,'')+'. You can close this page.</div>';
      }else{
        out.innerHTML='<div class="msg err">'+((x.j&&(ERR[x.j.code]||x.j.error))||'Something went wrong.')+'</div>';
        if(!x.j||['used','expired','revoked','stale','invalid'].indexOf(x.j.code)<0){bA.disabled=bR.disabled=false}
      }
    }).catch(function(){out.innerHTML='<div class="msg err">Network error — please try again.</div>';bA.disabled=bR.disabled=false});
  }
  bA.onclick=function(){go('approve')};bR.onclick=function(){go('reject')};
})();
</script>`));
});

router.post('/api/approvals/public/:token/decide', limiter, express.json({ limit: '10kb' }), async (req, res) => {
  try {
    const b = req.body || {};
    const out = await svc.decideByToken(req.params.token, { action: b.action, remarks: b.remarks, email: b.email, ip: req.ip });
    if (!out.ok) return res.status(out.code === 'invalid' ? 404 : 400).json({ ok: false, code: out.code });
    res.json(out);
  } catch (e) {
    console.error('[public-approval]', e);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

module.exports = router;
