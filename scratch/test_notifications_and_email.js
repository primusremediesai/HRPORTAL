const fs = require('fs');
const path = require('path');

async function testNotificationsAndEmail() {
  const base = 'http://localhost:3000';
  console.log('=== TESTING GMAIL / LINK SENDING, APPROVAL EMAIL & HR BELL NOTIFICATIONS ===\n');

  // 1. Employee login
  console.log('1. Logging in as Employee PRI014...');
  let res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'PRI014', password: 'EmployeePassword123!' })
  });
  if (!res.ok) throw new Error('Employee login failed: ' + res.status);
  const empCookie = res.headers.get('set-cookie');
  console.log('   Logged in successfully as PRI014.');

  // 2. Admin login
  console.log('\n2. Logging in as HR Admin (admin@primus.local)...');
  res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@primus.local', password: 'SuperSecurePassword123!' })
  });
  if (!res.ok) throw new Error('Admin login failed: ' + res.status);
  const adminCookie = res.headers.get('set-cookie');
  console.log('   Logged in successfully as HR Admin.');

  // 3. Register a new leave claim with 24-hour link
  const reqId = 'LV-NOTIF-' + Date.now().toString(36);
  console.log('\n3. Registering leave request with approval workflow:', reqId);
  res = await fetch(`${base}/api/ess/approvals/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': empCookie },
    body: JSON.stringify({
      requestId: reqId,
      kind: 'leave',
      title: 'Festival Vacation Leave (3 days)',
      lines: [
        { label: 'Leave type', value: 'Earned' },
        { label: 'From', value: '28 Oct 2026' },
        { label: 'To', value: '30 Oct 2026' },
        { label: 'Days', value: '3' },
        { label: 'Reason', value: 'Diwali celebration with family' }
      ],
      employee: { code: 'PRI014', name: 'Mekala Vamsi Krishna', email: 'vamsi.krishna@primus.local' },
      currentStage: 0,
      stages: [
        { role: 'manager', state: 'pending', approverCode: '', approverName: 'John Doe', approverEmail: 'manager.john@primus.local' },
        { role: 'hr', state: 'waiting', approverCode: '', approverName: '', approverEmail: 'admin@primus.local' }
      ]
    })
  });
  const regData = await res.json();
  if (!res.ok || !regData.ok) throw new Error('Registration failed: ' + JSON.stringify(regData));
  let link = regData.link;
  if (!link && regData.body) {
    const m = regData.body.match(/https?:\/\/[^\s]+/);
    if (m) link = m[0];
  }
  console.log('   Registration successful! Expires at (24h):', regData.expiresAt);
  console.log('   Temporary link issued in email draft:\n   ' + link);

  // 4. Test send-draft endpoint (e.g. employee sends draft via portal)
  console.log('\n4. Testing POST /api/ess/approvals/send-draft (direct email send)...');
  res = await fetch(`${base}/api/ess/approvals/send-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': empCookie },
    body: JSON.stringify({
      to: 'manager.john@primus.local',
      subject: `Action required: Leave request ${reqId}`,
      body: `Please review and decide using your 24h link: ${link}`
    })
  });
  const sendDraftRes = await res.json();
  console.log('   Send draft response:', sendDraftRes);
  if (!sendDraftRes.ok) throw new Error('Send draft failed: ' + JSON.stringify(sendDraftRes));

  // 5. Test HR Admin Notification Feed (Bell Icon Data)
  console.log('\n5. Fetching HR Admin notifications (Bell Icon Feed)...');
  res = await fetch(`${base}/api/ess/approvals/admin/notifications`, {
    headers: { 'Cookie': adminCookie }
  });
  if (!res.ok) throw new Error('Notification feed failed: ' + res.status);
  const notifFeed = await res.json();
  console.log('   Pending requests count:', notifFeed.pendingCount);
  const foundInFeed = notifFeed.pending.find(p => p.requestId === reqId);
  if (!foundInFeed) throw new Error('Newly created request not found in HR bell notification feed!');
  console.log('   Verified request in HR Admin Notification Feed:');
  console.log('   - Request ID:', foundInFeed.requestId);
  console.log('   - Title:', foundInFeed.title);
  console.log('   - Employee:', foundInFeed.employeeName, `(${foundInFeed.employeeCode})`);

  // 6. Manager approves via the temporary link
  const token = link.split('/approve/')[1];
  console.log('\n6. Manager John approves via temporary link (/api/approvals/public/:token/decide)...');
  res = await fetch(`${base}/api/approvals/public/${token}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'manager.john@primus.local',
      approverName: 'John Doe (Reporting Manager)',
      action: 'approve',
      remarks: 'Approved! Have a great festival.'
    })
  });
  const decideRes = await res.json();
  console.log('   Decide response:', decideRes);
  if (!decideRes.ok) throw new Error('Decision failed: ' + JSON.stringify(decideRes));

  // 7. Verify confirmation email to employee includes manager's email address
  console.log('\n7. Verifying confirmation email to employee in outbox...');
  const outboxDir = path.join(__dirname, '..', 'data', 'outbox');
  const files = fs.readdirSync(outboxDir).filter(f => f.endsWith('.json')).sort().reverse();
  let confMail = null;
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(outboxDir, f), 'utf8'));
    if (data.to === 'vamsi.krishna@primus.local' && (data.subject || '').includes(reqId)) {
      confMail = data;
      break;
    }
  }

  if (!confMail) throw new Error('Confirmation email to employee was not found in outbox!');
  console.log('   Found confirmation email sent to employee:');
  console.log('   - To:', confMail.to);
  console.log('   - Subject:', confMail.subject);
  
  if (!confMail.subject.includes('manager.john@primus.local')) {
    throw new Error('Subject does not contain approver email address!');
  }
  if (!confMail.text.includes('manager.john@primus.local')) {
    throw new Error('Email body does not contain approver email address!');
  }
  console.log('   CONFIRMED: Employee received email explicitly identifying manager.john@primus.local as approver!');

  // 8. Verify ESS reflects the decision
  console.log('\n8. Checking ESS sync for Employee PRI014...');
  res = await fetch(`${base}/api/ess/approvals/sync`, {
    headers: { 'Cookie': empCookie }
  });
  const syncRes = await res.json();
  const mySync = (syncRes.items || []).find(i => i.requestId === reqId);
  if (!mySync) throw new Error('Approval decision not found in employee ESS sync items!');
  console.log('   ESS sync item found! Decisions count:', mySync.decisions.length);
  const dec = mySync.decisions[0];
  console.log('   - Action:', dec.action);
  console.log('   - Actor Email:', dec.actorEmail);
  console.log('   - Remarks:', dec.remarks);
  if (dec.actorEmail !== 'manager.john@primus.local') {
    throw new Error('Actor email in ESS sync is not manager.john@primus.local');
  }

  // 9. Test Quick Decide from HR Admin Notification
  console.log('\n9. Testing Quick-Decide from HR Admin Notification Center (for stage 2)...');
  res = await fetch(`${base}/api/ess/approvals/admin/quick-decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
    body: JSON.stringify({
      requestId: reqId,
      action: 'approve',
      remarks: 'Final HR approval granted via Notification Bell Center'
    })
  });
  const quickRes = await res.json();
  console.log('   Quick decide result:', quickRes);
  if (!quickRes.ok || quickRes.status !== 'Approved') {
    throw new Error('Quick decision failed: ' + JSON.stringify(quickRes));
  }
  console.log('   Request successfully fully approved from HR Notification Center!');

  console.log('\n======================================================');
  console.log('>>> ALL VERIFICATION CHECKS PASSED WITH 100% SUCCESS! <<<');
  console.log('======================================================\n');
}

testNotificationsAndEmail().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
