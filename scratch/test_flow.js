const fs = require('fs');
const path = require('path');

async function run() {
  const base = 'http://localhost:3000';
  console.log('--- STARTING E2E INTEGRATION TEST ---');

  // Helper for cookies
  let empCookie = '';
  let adminCookie = '';

  // 1. Employee Login
  console.log('\n1. Logging in as Employee PRI014...');
  let res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'PRI014', password: 'EmployeePassword123!' })
  });
  if (!res.ok) throw new Error('Employee login failed: ' + res.status);
  empCookie = res.headers.get('set-cookie');
  const empUser = await res.json();
  console.log('   Logged in as:', empUser.user.name, 'Role:', empUser.user.role, 'Code:', empUser.user.employeeCode);

  // 2. Admin Login
  console.log('\n2. Logging in as Admin admin@primus.local...');
  res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@primus.local', password: 'SuperSecurePassword123!' })
  });
  if (!res.ok) throw new Error('Admin login failed: ' + res.status);
  adminCookie = res.headers.get('set-cookie');
  const adminUser = await res.json();
  console.log('   Logged in as:', adminUser.user.name, 'Role:', adminUser.user.role);

  // 3. Employee registers an approval request (e.g. Leave claim)
  const reqId = 'LV-TEST-' + Date.now().toString(36);
  console.log('\n3. Registering leave request with approval workflow:', reqId);
  res = await fetch(`${base}/api/ess/approvals/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': empCookie },
    body: JSON.stringify({
      requestId: reqId,
      kind: 'leave',
      title: 'Casual leave (2 days)',
      lines: [
        { label: 'Leave type', value: 'Casual' },
        { label: 'From', value: '25 Oct 2026' },
        { label: 'To', value: '26 Oct 2026' },
        { label: 'Days', value: '2' },
        { label: 'Reason', value: 'Personal family event' }
      ],
      employee: { code: 'PRI014', name: 'Vamsi Krishna', email: 'vamsi.krishna@primus.local' },
      currentStage: 0,
      stages: [
        { role: 'Manager', state: 'Pending', approverCode: '', approverName: '', approverEmail: 'manager@primus.local' },
        { role: 'HR', state: 'Waiting', approverCode: '', approverName: '', approverEmail: 'admin@primus.local' }
      ]
    })
  });
  const regData = await res.json();
  if (!res.ok || !regData.ok) throw new Error('Register failed: ' + JSON.stringify(regData));
  console.log('   Registration response: ok =', regData.ok);
  console.log('   Delivered via SMTP:', regData.delivered, 'Mode:', regData.mode);
  console.log('   Expires At (24h):', regData.expiresAt);
  
  // Extract link from outbox or body
  let link = regData.link;
  if (!link && regData.body) {
    const m = regData.body.match(/https?:\/\/[^\s]+/);
    if (m) link = m[0];
  }
  if (!link) {
    // Check outbox files
    const outboxDir = path.join(__dirname, '..', 'data', 'outbox');
    const files = fs.readdirSync(outboxDir).filter(f => f.endsWith('.json')).sort().reverse();
    for (const f of files) {
      const content = JSON.parse(fs.readFileSync(path.join(outboxDir, f), 'utf8'));
      if (content.tokenLink) { link = content.tokenLink; break; }
    }
  }
  console.log('   Found temporary approval link:', link);
  if (!link) throw new Error('No temporary link generated!');

  const token = link.split('/approve/')[1];
  console.log('   Token:', token);

  // 4. Test public GET /approve/:token
  console.log('\n4. Approver opens the temporary link (GET /approve/:token)...');
  res = await fetch(`${base}/approve/${token}`);
  if (res.status !== 200) throw new Error('Public approve page failed: ' + res.status);
  const pageHtml = await res.text();
  console.log('   Approval page loaded successfully! Length:', pageHtml.length);
  if (!pageHtml.includes('your decision') && !pageHtml.includes('You are approving as')) {
    throw new Error('Approval page did not contain expected content');
  }

  // 5. Test Self-Approval Protection
  console.log('\n5. Testing self-approval protection (Employee attempting to approve with their own email)...');
  res = await fetch(`${base}/api/approvals/public/${token}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'vamsi.krishna@primus.local',
      action: 'approve',
      remarks: 'Self approval attempt'
    })
  });
  const selfApproveRes = await res.json();
  console.log('   Self-approval response:', res.status, selfApproveRes.code);
  if (res.status === 200 || !selfApproveRes.code) {
    throw new Error('Security check failed: self approval was not blocked!');
  }

  // 6. Legitimate Manager / HR Approval
  console.log('\n6. Approver submits decision (Approve with email manager@primus.local)...');
  res = await fetch(`${base}/api/approvals/public/${token}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'manager@primus.local',
      approverName: 'Divisional Manager',
      action: 'approve',
      remarks: 'Approved. Enjoy your leave!'
    })
  });
  const decideRes = await res.json();
  console.log('   Decision result:', decideRes);
  if (!decideRes.ok) throw new Error('Approval decision failed: ' + JSON.stringify(decideRes));

  // 7. Verify Single-Use Token: Attempt to use the same token again
  console.log('\n7. Verifying single-use token protection (re-submitting same token)...');
  res = await fetch(`${base}/api/approvals/public/${token}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'manager@primus.local',
      action: 'approve',
      remarks: 'Duplicate attempt'
    })
  });
  const dupRes = await res.json();
  console.log('   Duplicate token response:', res.status, dupRes.code);
  if (res.status === 200 || dupRes.ok) {
    throw new Error('Security check failed: single-use token was reused!');
  }

  // 8. Employee ESS Syncs Approval
  console.log('\n8. Checking ESS sync for Employee PRI014...');
  res = await fetch(`${base}/api/ess/approvals/sync`, {
    headers: { 'Cookie': empCookie }
  });
  const syncData = await res.json();
  console.log('   Sync response items count:', (syncData.items || []).length);
  const myItem = (syncData.items || []).find(i => i.requestId === reqId);
  if (!myItem) throw new Error('Decision not found in employee sync items!');
  console.log('   Found synced decision for request:', myItem.requestId);
  console.log('   Decisions recorded:', myItem.decisions);
  const decision = myItem.decisions[0];
  console.log('   Actor email verified in approval:', decision.actorEmail);
  if (decision.actorEmail !== 'manager@primus.local') {
    throw new Error('Actor email mismatch in sync decision!');
  }

  // 9. Employee acknowledges sync
  console.log('\n9. Acknowledging sync...');
  res = await fetch(`${base}/api/ess/approvals/sync/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': empCookie },
    body: JSON.stringify({ items: [{ requestId: reqId, seq: decision.seq }] })
  });
  const ackRes = await res.json();
  console.log('   Ack response:', ackRes);

  // 10. HR Uploads Documents (Onboarding & Promotion) for Employee PRI014
  console.log('\n10. Testing HR Document Upload (Onboarding & Promotion Letter)...');
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const fileContent = 'Dummy PDF document content for Primus Remedies HR Vault testing';
  
  function makeMultipart(fields, fileField, fileName, fileData) {
    let body = '';
    for (const [k, v] of Object.entries(fields)) {
      body += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
    }
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`;
    const payload = Buffer.concat([
      Buffer.from(body, 'utf8'),
      Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData, 'utf8'),
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
    ]);
    return payload;
  }

  const uploadPayload = makeMultipart(
    {
      employeeCode: 'PRI014',
      employeeName: 'Vamsi Krishna',
      category: 'Onboarding Documents',
      title: 'Employee Joining & Onboarding Dossier',
      period: 'FY 2025-26',
      remarks: 'Signed joining kit verified by HR'
    },
    'file',
    'onboarding_kit_PRI014.pdf',
    fileContent
  );

  res = await fetch(`${base}/api/hr-docs/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Cookie': adminCookie
    },
    body: uploadPayload
  });
  const uploadData = await res.json();
  if (!res.ok || !uploadData.success) throw new Error('HR doc upload failed: ' + JSON.stringify(uploadData));
  console.log('   Document uploaded successfully! ID:', uploadData.document.id);
  console.log('   Document Category:', uploadData.document.category);
  console.log('   Storage Type:', uploadData.document.storageType);
  const docId = uploadData.document.id;

  // 11. Employee views own HR Vault documents
  console.log('\n11. Employee queries HR Vault (/api/hr-docs/mine)...');
  res = await fetch(`${base}/api/hr-docs/mine`, {
    headers: { 'Cookie': empCookie }
  });
  const mineData = await res.json();
  console.log('   Employee vault documents count:', mineData.documents.length);
  const foundDoc = mineData.documents.find(d => d.id === docId);
  if (!foundDoc) throw new Error('Uploaded document not visible to employee!');
  console.log('   Verified document in employee vault:', foundDoc.title, 'Category:', foundDoc.category);

  // 12. Employee downloads own document
  console.log('\n12. Employee downloads document (/api/hr-docs/:id/download)...');
  res = await fetch(`${base}/api/hr-docs/${docId}/download`, {
    headers: { 'Cookie': empCookie }
  });
  if (!res.ok) throw new Error('Employee download failed: ' + res.status);
  const downloadedText = await res.text();
  if (downloadedText !== fileContent) throw new Error('Downloaded content does not match original file!');
  console.log('   Downloaded content verified perfectly (exact match)!');

  // 13. Unauthorized access check: regular employee cannot upload
  console.log('\n13. Security check: Regular employee cannot upload HR documents...');
  res = await fetch(`${base}/api/hr-docs/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Cookie': empCookie
    },
    body: uploadPayload
  });
  console.log('   Employee upload attempt status:', res.status);
  if (res.status !== 403) throw new Error('Security check failed: non-HR was able to upload!');

  console.log('\n=============================================');
  console.log('>>> ALL INTEGRATION TESTS PASSED 100%! <<<');
  console.log('=============================================\n');
}

run().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
