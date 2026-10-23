/* ==========================================================================
   PRIMUS REMEDIES — ESS — USER INTERFACE & SCREEN RENDERERS
   Dashboard • Attendance & Face Verification • Leave Management •
   Holidays & Integrated Calendar • Expenses • Document Vault •
   Manager / HR Approvals • Notifications • Settings & Audit Verifier.
   ========================================================================== */
(function (global) {
  'use strict';
  const ESS = (global.ESS = global.ESS || {});

  ESS.UI = {
    currentTab: 'overview',
    liveTimer: null,

    /**
     * Mounts the ESS top persona bar and sets up bottom navigation.
     */
    async mount() {
      // Ensure defaults & schemas exist
      await ESS.Settings.load();
      await ESS.Org.rebuild();
      await ESS.Holidays.init();
      await ESS.Leave.initPolicies();

      // Ensure active actor
      let actor = ESS.Auth.actor();
      if (!actor) {
        actor = ESS.Auth.restore();
        if (!actor) {
          // Default to first active employee in directory or PRI014
          const emp = ESS.Org.get('PRI014') || ESS.Org.active()[0];
          actor = ESS.Auth.signIn(emp ? emp.EmployeeCode : 'PRI014', 'employee');
        }
      }

      this.renderTopBar();
      this.renderBottomNav();
    },

    /**
     * Top Persona & Switcher bar (allows evaluating as any Employee or HR Admin).
     */
    renderTopBar() {
      let bar = document.getElementById('essTopBar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'essTopBar';
        bar.className = 'ess-role-switcher-bar';
        const appContainer = document.getElementById('app');
        if (appContainer) appContainer.parentNode.insertBefore(bar, appContainer);
        else document.body.insertBefore(bar, document.body.firstChild);
      }

      const actor = ESS.Auth.actor();
      const allEmps = ESS.Org.active();
      const directCount = actor && actor.emp ? ESS.Org.directReports(actor.code).length : 0;
      const rolesLabel = actor ? [...actor.roles].join(', ') : '';

      bar.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="font-weight:700;letter-spacing:0.5px;color:#10b981;">PRIMUS REMEDIES</span>
          <span>|</span>
          <span style="opacity:0.85;">Current Session:</span>
          <strong>${actor ? actor.name : 'Not Signed In'}</strong>
          <span class="ess-role-badge">${rolesLabel}</span>
          ${directCount > 0 ? `<span style="background:#0d9488;color:white;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;">Manager of ${directCount}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <label style="opacity:0.8;font-size:11px;">Switch Persona:</label>
          <select class="ess-switcher-select" onchange="ESS.UI.onSwitchPersona(this.value)">
            <option value="ADMIN" ${actor && actor.kind === 'admin' ? 'selected' : ''}>★ HR Admin (Executive & Admin View)</option>
            <optgroup label="Employees (Reporting Managers & Field Staff)">
              ${allEmps.slice(0, 80).map(e => `
                <option value="${e.EmployeeCode}" ${actor && actor.code === e.EmployeeCode ? 'selected' : ''}>
                  ${e.EmployeeCode} — ${e.EmployeeName} (${e.Designation || e.Division || 'Employee'})
                </option>
              `).join('')}
            </optgroup>
          </select>
        </div>
      `;
    },

    /**
     * Renders Mobile Bottom Navigation bar.
     */
    renderBottomNav() {
      let bnav = document.getElementById('essBottomNav');
      if (!bnav) {
        bnav = document.createElement('div');
        bnav.id = 'essBottomNav';
        bnav.className = 'ess-bottom-nav';
        document.body.appendChild(bnav);
      }

      const cur = State.currentPage || 'ess-dashboard';
      const actor = ESS.Auth.actor();
      const isMgrOrHR = actor && (actor.roles.has('manager') || actor.roles.has('hr') || actor.roles.has('admin'));

      bnav.innerHTML = `
        <div class="ess-bottom-nav-inner">
          <div class="ess-bnav-item ${cur === 'ess-dashboard' ? 'active' : ''}" onclick="App.navigate('ess-dashboard')">
            <span class="bnav-icon">🏠</span>
            <span>Home</span>
          </div>
          <div class="ess-bnav-item ${cur === 'ess-attendance' ? 'active' : ''}" onclick="App.navigate('ess-attendance')">
            <span class="bnav-icon">⏱️</span>
            <span>Clock</span>
          </div>
          <div class="ess-bnav-item ${cur === 'ess-leave' ? 'active' : ''}" onclick="App.navigate('ess-leave')">
            <span class="bnav-icon">🏖️</span>
            <span>Leave</span>
          </div>
          <div class="ess-bnav-item ${cur === 'ess-expenses' ? 'active' : ''}" onclick="App.navigate('ess-expenses')">
            <span class="bnav-icon">💳</span>
            <span>Expenses</span>
          </div>
          ${isMgrOrHR ? `
            <div class="ess-bnav-item ${cur === 'ess-approvals' ? 'active' : ''}" onclick="App.navigate('ess-approvals')">
              <span class="bnav-icon">✅</span>
              <span>Approvals</span>
            </div>
          ` : `
            <div class="ess-bnav-item ${cur === 'ess-documents' ? 'active' : ''}" onclick="App.navigate('ess-documents')">
              <span class="bnav-icon">📁</span>
              <span>Vault</span>
            </div>
          `}
        </div>
      `;
    },

    /**
     * Handles switching personas from the top selector.
     */
    async onSwitchPersona(val) {
      if (val === 'ADMIN') {
        ESS.Auth.signIn('HR-ADMIN', 'admin');
      } else {
        ESS.Auth.signIn(val, 'employee');
      }
      this.renderTopBar();
      this.renderBottomNav();
      App.showToast(`Switched active session to ${ESS.Auth.actor().name}`, 'info');
      App.navigate(State.currentPage && State.currentPage.startsWith('ess-') ? State.currentPage : 'ess-dashboard');
    },

    /* ---------------------------------------------------------------------- */
    /* 1. EMPLOYEE DASHBOARD (ess-dashboard)                                  */
    /* ---------------------------------------------------------------------- */
    async renderDashboard(container) {
      const actor = ESS.Auth.actor();
      if (!actor || actor.kind === 'admin') {
        container.innerHTML = `
          <div class="ess-container">
            <div class="card" style="padding:32px;text-align:center;">
              <h2>HR Administrative Console Active</h2>
              <p style="color:var(--ess-text-muted);margin:12px 0 20px;">
                You are currently viewing as HR Admin. To experience the personalized employee dashboard, clock-in, and leave forms, please select an employee persona from the top bar (e.g., Mekala Vamsi Krishna - PRI014).
              </p>
              <div style="display:flex;justify-content:center;gap:12px;">
                <button class="btn btn-primary" onclick="ESS.UI.onSwitchPersona('PRI014')">Switch to PRI014 (Employee)</button>
                <button class="btn btn-outline" onclick="App.navigate('overview')">Return to HR Intelligence Portal</button>
              </div>
            </div>
          </div>
        `;
        return;
      }

      const emp = actor.emp || ESS.Org.get(actor.code);
      const mgr = ESS.Org.managerOf(emp.EmployeeCode);
      const todaySession = await ESS.Attendance.getTodaySession(emp.EmployeeCode);
      const balances = await ESS.Leave.getBalances(emp.EmployeeCode);
      const expMetrics = await ESS.Expense.getMetrics(emp.EmployeeCode);
      const holidays = await ESS.Holidays.getForEmployee(emp.EmployeeCode, new Date().getFullYear());
      const nextHoliday = holidays.find(h => h.date >= ESS.T.today());
      const docs = await ESS.Documents.getEmployeeDocuments(emp.EmployeeCode);
      const allLeaves = await ESS.Leave.getEmployeeApplications(emp.EmployeeCode);
      const pendingLeaves = allLeaves.filter(l => ESS.Flow.isPending(l.status));
      const unreadCount = await ESS.Notify.unreadCount();

      // Attendance status summary
      let attStatusText = 'Not Clocked In';
      let attStatusColor = 'var(--ess-text-light)';
      if (todaySession) {
        if (todaySession.clockIn && !todaySession.clockOut) {
          attStatusText = `Clocked In (${ESS.T.time(todaySession.clockIn)})`;
          attStatusColor = '#10b981';
        } else if (todaySession.clockOut) {
          attStatusText = `Completed (${ESS.T.dur(todaySession.durationMinutes)})`;
          attStatusColor = '#0284c7';
        }
      }

      container.innerHTML = `
        <div class="ess-container">
          <!-- HERO CARD -->
          <div class="ess-hero-card">
            <div class="ess-hero-profile">
              <div class="ess-hero-avatar">${Utils.getInitials(emp.EmployeeName)}</div>
              <div>
                <div class="ess-hero-name">${Utils.escapeHtml(emp.EmployeeName)}</div>
                <div class="ess-hero-meta">
                  <span class="ess-hero-meta-item">ID: <strong>${emp.EmployeeCode}</strong></span>
                  <span class="ess-hero-meta-item">${emp.Designation || 'Team Member'}</span>
                  <span class="ess-hero-meta-item">${emp.Division || 'Primus'}</span>
                  <span class="ess-hero-meta-item">HQ: <strong>${emp.HQ || 'Telangana'}</strong></span>
                  <span class="ess-hero-meta-item">Reports to: <strong>${mgr ? mgr.EmployeeName : 'HR Department'}</strong></span>
                </div>
              </div>
            </div>
            <div class="ess-hero-clock-box">
              <div class="ess-live-clock" id="essHeroLiveClock">${ESS.T.time(new Date().toISOString())}</div>
              <div class="ess-live-date">${ESS.T.date(ESS.T.today())}</div>
              <div style="font-size:12px;margin-top:6px;display:flex;align-items:center;gap:6px;justify-content:flex-end;">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${attStatusColor};"></span>
                <span>${attStatusText}</span>
              </div>
            </div>
          </div>

          <!-- QUICK ACTIONS -->
          <div class="ess-quick-actions-bar">
            <div class="ess-quick-actions-title">⚡ Quick Actions</div>
            <div class="ess-actions-grid">
              <div class="ess-action-btn primary-action" onclick="App.navigate('ess-attendance')">
                <span class="ess-action-icon">⏱️</span>
                <span>${todaySession && todaySession.clockIn && !todaySession.clockOut ? 'Clock Out' : 'Clock In'}</span>
              </div>
              <div class="ess-action-btn" onclick="App.navigate('ess-leave')">
                <span class="ess-action-icon">🏖️</span>
                <span>Apply Leave</span>
              </div>
              <div class="ess-action-btn" onclick="App.navigate('ess-expenses')">
                <span class="ess-action-icon">💳</span>
                <span>Claim Expense</span>
              </div>
              <div class="ess-action-btn" onclick="App.navigate('ess-documents')">
                <span class="ess-action-icon">📄</span>
                <span>View Payslips</span>
              </div>
              <div class="ess-action-btn" onclick="App.navigate('ess-calendar')">
                <span class="ess-action-icon">📅</span>
                <span>Holidays</span>
              </div>
              <div class="ess-action-btn" onclick="App.navigate('ess-documents')">
                <span class="ess-action-icon">📁</span>
                <span>HR Vault</span>
              </div>
            </div>
          </div>

          <!-- KPI STATS CARDS -->
          <div class="ess-kpi-grid">
            <div class="ess-kpi-card" onclick="App.navigate('ess-attendance')">
              <div class="ess-kpi-top">
                <span class="ess-kpi-label">Today's Attendance</span>
                <span class="ess-kpi-icon">⏱️</span>
              </div>
              <div class="ess-kpi-val">${todaySession ? todaySession.status : 'Not Clocked'}</div>
              <div class="ess-kpi-sub">
                ${todaySession && todaySession.clockIn ? `In: ${ESS.T.time(todaySession.clockIn)}` : 'Shift starts 09:30 AM'}
              </div>
            </div>

            <div class="ess-kpi-card" onclick="App.navigate('ess-leave')">
              <div class="ess-kpi-top">
                <span class="ess-kpi-label">Available Leave</span>
                <span class="ess-kpi-icon">🏖️</span>
              </div>
              <div class="ess-kpi-val">${(balances.CL.available || 0) + (balances.SL.available || 0) + (balances.EL.available || 0)} <span style="font-size:14px;font-weight:500;">days</span></div>
              <div class="ess-kpi-sub">
                CL: ${balances.CL.available} · SL: ${balances.SL.available} · EL: ${balances.EL.available}
              </div>
            </div>

            <div class="ess-kpi-card" onclick="App.navigate('ess-leave')">
              <div class="ess-kpi-top">
                <span class="ess-kpi-label">Pending Requests</span>
                <span class="ess-kpi-icon">⏳</span>
              </div>
              <div class="ess-kpi-val">${pendingLeaves.length}</div>
              <div class="ess-kpi-sub">
                ${pendingLeaves.length ? 'Awaiting reviewer action' : 'All requests processed'}
              </div>
            </div>

            <div class="ess-kpi-card" onclick="App.navigate('ess-expenses')">
              <div class="ess-kpi-top">
                <span class="ess-kpi-label">Pending Claims</span>
                <span class="ess-kpi-icon">💰</span>
              </div>
              <div class="ess-kpi-val">${ESS.inr(expMetrics.pending)}</div>
              <div class="ess-kpi-sub">
                Reimbursed: ${ESS.inr(expMetrics.reimbursed)}
              </div>
            </div>

            <div class="ess-kpi-card" onclick="App.navigate('ess-calendar')">
              <div class="ess-kpi-top">
                <span class="ess-kpi-label">Upcoming Holiday</span>
                <span class="ess-kpi-icon">🎉</span>
              </div>
              <div class="ess-kpi-val" style="font-size:16px;">${nextHoliday ? nextHoliday.name : 'None'}</div>
              <div class="ess-kpi-sub">
                ${nextHoliday ? `${ESS.T.date(nextHoliday.date)} (${nextHoliday.weekday})` : 'All done for this year'}
              </div>
            </div>

            <div class="ess-kpi-card" onclick="App.navigate('ess-documents')">
              <div class="ess-kpi-top">
                <span class="ess-kpi-label">My Documents</span>
                <span class="ess-kpi-icon">📁</span>
              </div>
              <div class="ess-kpi-val">${docs.length}</div>
              <div class="ess-kpi-sub">
                ${docs.length ? 'Available in secure vault' : 'No letters uploaded yet'}
              </div>
            </div>
          </div>

          <!-- RECENT ACTIVITY & SUMMARY GRIDS -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(360px, 1fr));gap:20px;">
            <!-- Leave Balance Breakdown Card -->
            <div class="card">
              <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
                <div class="card-title">Leave Balance Overview</div>
                <button class="btn btn-xs btn-outline" onclick="App.navigate('ess-leave')">Apply Leave</button>
              </div>
              <div class="card-body">
                <table class="table" style="font-size:13px;">
                  <thead>
                    <tr>
                      <th>Leave Type</th>
                      <th>Allocated</th>
                      <th>Used</th>
                      <th>Pending</th>
                      <th>Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${['CL', 'SL', 'EL', 'LOP', 'C-Off'].map(code => {
                      const b = balances[code];
                      return `
                        <tr>
                          <td><strong>${code}</strong></td>
                          <td>${b.allocated != null ? b.allocated : '—'}</td>
                          <td>${b.used}</td>
                          <td>${b.pending}</td>
                          <td><strong style="color:var(--ess-forest);">${b.available != null ? b.available : 'Uncapped'}</strong></td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Recent Notifications / Announcements -->
            <div class="card">
              <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
                <div class="card-title">Notifications & Updates</div>
                <button class="btn btn-xs btn-ghost" onclick="App.navigate('ess-notifications')">View All (${unreadCount} unread)</button>
              </div>
              <div class="card-body" id="essDashNotifications">
                <div style="color:var(--ess-text-muted);font-size:13px;padding:8px 0;">Loading notifications...</div>
              </div>
            </div>
          </div>
        </div>
      `;

      // Start live clock tick
      if (this.liveTimer) clearInterval(this.liveTimer);
      this.liveTimer = setInterval(() => {
        const el = document.getElementById('essHeroLiveClock');
        if (el) el.textContent = ESS.T.time(new Date().toISOString());
      }, 1000);

      // Async load dash notifications
      ESS.Notify.mine().then(notes => {
        const el = document.getElementById('essDashNotifications');
        if (!el) return;
        if (!notes || notes.length === 0) {
          el.innerHTML = '<div style="color:var(--ess-text-muted);font-size:13px;padding:12px;text-align:center;">No recent notifications. You are all caught up!</div>';
          return;
        }
        el.innerHTML = notes.slice(0, 4).map(n => `
          <div style="padding:10px 0;border-bottom:1px solid var(--ess-border-subtle);display:flex;align-items:flex-start;gap:10px;">
            <span style="font-size:16px;">${n.type === 'success' ? '✅' : n.type === 'danger' ? '❌' : 'ℹ️'}</span>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:var(--ess-charcoal);">${Utils.escapeHtml(n.title)}</div>
              <div style="font-size:12px;color:var(--ess-text-secondary);">${Utils.escapeHtml(n.body)}</div>
              <div style="font-size:11px;color:var(--ess-text-light);margin-top:2px;">${ESS.T.dateTime(n.createdAt)}</div>
            </div>
          </div>
        `).join('');
      });
    },

    /* ---------------------------------------------------------------------- */
    /* 2. ATTENDANCE & FACE VERIFICATION SCREEN (ess-attendance)              */
    /* ---------------------------------------------------------------------- */
    async renderAttendance(container) {
      const actor = ESS.Auth.actor();
      if (!actor || !actor.emp) {
        container.innerHTML = `<div class="ess-container"><div class="card" style="padding:24px;">Please select an employee persona to access attendance punches.</div></div>`;
        return;
      }

      const emp = actor.emp;
      const todaySession = await ESS.Attendance.getTodaySession(emp.EmployeeCode);
      const faceStatus = ESS.Face.getStatus();
      const calData = await ESS.Attendance.getCalendarMonthData(emp.EmployeeCode, new Date().getFullYear(), new Date().getMonth() + 1);

      container.innerHTML = `
        <div class="ess-container">
          <div class="ess-header-bar">
            <div>
              <div class="ess-title">⏱️ Attendance & Face Verification</div>
              <div class="ess-subtitle">Record daily attendance with authorized face identity verification and GPS location.</div>
            </div>
            <button class="btn btn-outline" onclick="ESS.UI.openCorrectionModal('${emp.EmployeeCode}')">
              ✏️ Request Missed Punch Correction
            </button>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(360px, 1fr));gap:24px;margin-bottom:24px;">
            <!-- CLOCK IN / OUT WORKBENCH -->
            <div class="ess-clock-card">
              <h3 style="font-size:16px;font-weight:700;margin-bottom:16px;color:var(--ess-charcoal);">
                Daily Punch Console
              </h3>

              <!-- Office / Location selector -->
              <div class="ess-location-select-box">
                <label>Work Location (Mandatory)</label>
                <select id="essClockLocation" onchange="ESS.UI.onLocationChange(this.value)">
                  <option value="Uppal">Uppal (Primus Office)</option>
                  <option value="Secunderabad">Secunderabad (Corporate Office)</option>
                  <option value="Current Location">Current Location (Browser Geolocation)</option>
                </select>
                <div id="essLocationNotice" class="ess-notice-badge info">
                  📍 Selected office: Uppal (Predefined Primus location)
                </div>
              </div>

              <!-- Camera View & Oval -->
              <div class="ess-camera-view-container" id="essCameraBox">
                <video id="essCameraVideo" class="ess-camera-video" autoplay playsinline muted></video>
                <div class="ess-face-oval-guide" id="essFaceOval"></div>
                <div class="face-feedback" id="faceGuideFeedback">Camera inactive. Click "Start Camera" to verify.</div>
              </div>

              <!-- Verification status notice -->
              <div style="margin-bottom:16px;text-align:center;">
                <span class="status-badge ${faceStatus.mode === 'none' ? 'badge-incomplete' : 'badge-leave'}">
                  ${faceStatus.label}
                </span>
                ${faceStatus.mode === 'none' ? `
                  <div style="font-size:12px;color:var(--danger);margin-top:6px;">
                    Face verification is not configured. Enable demo mode in ESS Settings to test locally.
                  </div>
                ` : ''}
              </div>

              <!-- Action Buttons -->
              <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap;">
                <button class="btn btn-outline" id="btnStartCamera" onclick="ESS.UI.startAttendanceCamera()">
                  📷 Open Camera
                </button>
                ${(!todaySession || !todaySession.clockIn) ? `
                  <button class="btn btn-primary" id="btnClockIn" onclick="ESS.UI.executeClock('in')">
                    Clock In
                  </button>
                ` : (!todaySession.clockOut ? `
                  <button class="btn btn-danger" id="btnClockOut" onclick="ESS.UI.executeClock('out')">
                    Clock Out
                  </button>
                ` : `
                  <button class="btn btn-secondary" disabled>
                    ✓ Session Completed Today
                  </button>
                `)}
              </div>
            </div>

            <!-- TODAY'S SESSION & SHIFT RULES -->
            <div class="card">
              <div class="card-header">
                <div class="card-title">Today's Session & Working Hours</div>
              </div>
              <div class="card-body">
                <div style="padding:12px;background:var(--ess-bg);border-radius:var(--ess-radius-sm);margin-bottom:16px;">
                  <div style="font-size:12px;color:var(--ess-text-muted);text-transform:uppercase;font-weight:600;">Shift Schedule</div>
                  <div style="font-size:14px;font-weight:600;margin-top:2px;">Standard Shift: 09:30 AM – 06:00 PM (8h 30m)</div>
                  <div style="font-size:12px;color:var(--ess-text-secondary);margin-top:2px;">Grace Period: 15 minutes · Minimum Full Day: 8 hours</div>
                </div>

                <table class="table" style="font-size:13px;">
                  <tr>
                    <td style="color:var(--ess-text-muted);width:140px;">Clock-In:</td>
                    <td><strong>${todaySession && todaySession.clockIn ? ESS.T.time(todaySession.clockIn) : '—'}</strong></td>
                  </tr>
                  <tr>
                    <td style="color:var(--ess-text-muted);">Clock-In Location:</td>
                    <td>${todaySession && todaySession.locationIn ? todaySession.locationIn : '—'}</td>
                  </tr>
                  <tr>
                    <td style="color:var(--ess-text-muted);">Clock-Out:</td>
                    <td><strong>${todaySession && todaySession.clockOut ? ESS.T.time(todaySession.clockOut) : (todaySession && todaySession.clockIn ? 'Session In Progress...' : '—')}</strong></td>
                  </tr>
                  <tr>
                    <td style="color:var(--ess-text-muted);">Duration:</td>
                    <td><strong>${todaySession ? ESS.T.dur(todaySession.durationMinutes) : '0h 00m'}</strong></td>
                  </tr>
                  <tr>
                    <td style="color:var(--ess-text-muted);">Status:</td>
                    <td>
                      ${todaySession ? `<span class="status-badge ${todaySession.status === 'Present' ? 'confirmed' : 'warning'}">${todaySession.status}</span>` : '<span class="status-badge">Not Clocked</span>'}
                    </td>
                  </tr>
                  <tr>
                    <td style="color:var(--ess-text-muted);">Verification:</td>
                    <td>
                      ${todaySession && todaySession.verificationIn ? `Verified (${todaySession.verificationIn.mode})` : 'Pending'}
                    </td>
                  </tr>
                </table>
              </div>
            </div>
          </div>

          <!-- MONTHLY ATTENDANCE CALENDAR -->
          <div class="ess-calendar-wrapper">
            <div class="ess-calendar-header">
              <div style="font-weight:700;font-size:16px;color:var(--ess-charcoal);">
                Monthly Attendance & Punch Record — ${ESS.T.monthLabel(calData.monthKey)}
              </div>
              <div style="display:flex;align-items:center;gap:12px;font-size:12px;">
                <span>Present: <strong style="color:#166534;">${calData.stats.present}</strong></span>
                <span>Late: <strong style="color:#92400e;">${calData.days.filter(d => d.type === 'Late Arrival').length}</strong></span>
                <span>Leave: <strong style="color:#115e59;">${calData.stats.leave}</strong></span>
                <span>Absent: <strong style="color:#991b1b;">${calData.stats.absent}</strong></span>
                <span>Holidays: <strong style="color:#86198f;">${calData.stats.holiday}</strong></span>
              </div>
            </div>

            <div class="ess-cal-grid">
              ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `
                <div class="ess-cal-day-header">${d}</div>
              `).join('')}

              ${calData.days.map(d => `
                <div class="ess-cal-cell ${d.isToday ? 'today' : ''}">
                  <div class="ess-cal-date-num">${d.day}</div>
                  <span class="ess-cal-pill ${d.badge}">
                    ${d.type}
                  </span>
                  ${d.detail ? `
                    <div style="font-size:10px;color:var(--ess-text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${d.detail}">
                      ${d.detail}
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    },

    onLocationChange(val) {
      const notice = document.getElementById('essLocationNotice');
      if (!notice) return;
      if (val === 'Current Location') {
        notice.className = 'ess-notice-badge warning';
        notice.innerHTML = '⚠️ Browser GPS permission will be requested upon clocking in.';
      } else {
        notice.className = 'ess-notice-badge info';
        notice.innerHTML = `📍 Selected office: ${val} (Predefined Primus location)`;
      }
    },

    async startAttendanceCamera() {
      const video = document.getElementById('essCameraVideo');
      if (!video) return;
      try {
        await ESS.Face.startCamera(video);
        document.getElementById('btnStartCamera').textContent = '✓ Camera Active';
        App.showToast('Camera stream active. Position face in oval.', 'info');
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    },

    async executeClock(direction) {
      const actor = ESS.Auth.actor();
      const loc = document.getElementById('essClockLocation').value;
      const oval = document.getElementById('essFaceOval');
      const feedback = document.getElementById('faceGuideFeedback');

      try {
        // Ensure camera started
        if (!ESS.Face.stream) {
          await this.startAttendanceCamera();
        }

        feedback.textContent = 'Verifying facial identity...';
        feedback.className = 'face-feedback good';

        // Perform face verification
        const faceRes = await ESS.Face.verify(actor.code);
        if (oval) oval.classList.add('verified');

        App.showToast(`Identity verified via ${faceRes.mode} mode. Recording punch...`, 'info');

        let session;
        if (direction === 'in') {
          session = await ESS.Attendance.clockIn({
            empCode: actor.code,
            location: loc,
            faceResult: faceRes
          });
          App.showToast(`Clock-In successful at ${ESS.T.time(session.clockIn)} (${session.status})`, 'success');
        } else {
          session = await ESS.Attendance.clockOut({
            empCode: actor.code,
            location: loc,
            faceResult: faceRes
          });
          App.showToast(`Clock-Out successful at ${ESS.T.time(session.clockOut)}. Duration: ${ESS.T.dur(session.durationMinutes)}`, 'success');
        }

        // Clean up camera
        ESS.Face.stopCamera();
        App.navigate('ess-attendance');
      } catch (err) {
        if (oval) oval.classList.remove('verified');
        if (feedback) {
          feedback.textContent = err.message;
          feedback.className = 'face-feedback low_light';
        }
        App.showToast(err.message, 'error');
      }
    },

    /**
     * Missed punch correction request modal.
     */
    openCorrectionModal(empCode) {
      const today = ESS.T.today();
      App.showModal(
        'Request Attendance Punch Correction',
        `
          <div style="font-size:13px;">
            <p style="color:var(--ess-text-secondary);margin-bottom:16px;">
              Submit a correction request for missed punches, incorrect punch times, or system exceptions. This will be routed to your reporting manager for approval.
            </p>
            <div class="form-group">
              <label>Punch Date (Within last 30 days)</label>
              <input type="date" id="corDate" value="${today}" max="${today}">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label>Proposed Clock-In Time</label>
                <input type="time" id="corIn" value="09:30">
              </div>
              <div class="form-group">
                <label>Proposed Clock-Out Time</label>
                <input type="time" id="corOut" value="18:00">
              </div>
            </div>
            <div class="form-group">
              <label>Reason for Correction (Detailed explanation)</label>
              <textarea id="corReason" rows="3" placeholder="e.g. On-field doctor visit in Uppal, biometric device unreachable."></textarea>
            </div>
          </div>
        `,
        `
          <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="ESS.UI.submitCorrection('${empCode}')">Submit Correction Request</button>
        `
      );
    },

    async submitCorrection(empCode) {
      const date = document.getElementById('corDate').value;
      const cin = document.getElementById('corIn').value;
      const cout = document.getElementById('corOut').value;
      const reason = document.getElementById('corReason').value;

      try {
        const proposedIn = cin ? `${date}T${cin}:00.000Z` : null;
        const proposedOut = cout ? `${date}T${cout}:00.000Z` : null;

        const res = await ESS.Attendance.submitCorrection({
          empCode,
          date,
          proposedIn,
          proposedOut,
          reason
        });

        App.closeModal();
        App.showToast(`Attendance correction request submitted (Ref: ${res.correction.id})`, 'success');
        this.openEmailDraftModal(res.emailDraft.id);
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    },

    /* ---------------------------------------------------------------------- */
    /* 3. LEAVE MANAGEMENT SCREEN (ess-leave)                                 */
    /* ---------------------------------------------------------------------- */
    async renderLeave(container) {
      const actor = ESS.Auth.actor();
      if (!actor || !actor.emp) {
        container.innerHTML = `<div class="ess-container"><div class="card" style="padding:24px;">Please select an employee persona to manage leaves.</div></div>`;
        return;
      }

      const emp = actor.emp;
      const year = new Date().getFullYear();
      const balances = await ESS.Leave.getBalances(emp.EmployeeCode, year);
      const applications = await ESS.Leave.getEmployeeApplications(emp.EmployeeCode);

      container.innerHTML = `
        <div class="ess-container">
          <div class="ess-header-bar">
            <div>
              <div class="ess-title">🏖️ Leave Management</div>
              <div class="ess-subtitle">View configured entitlements, track balances, apply for leave, and view approval status.</div>
            </div>
            <button class="btn btn-primary" onclick="ESS.UI.openApplyLeaveModal('${emp.EmployeeCode}')">
              + Apply For Leave
            </button>
          </div>

          <!-- LEAVE BALANCES GRID -->
          <div class="ess-kpi-grid" style="margin-bottom:24px;">
            ${ESS.Leave.TYPES.map(t => {
              const b = balances[t.code] || { allocated: 0, used: 0, pending: 0, available: 0 };
              return `
                <div class="ess-kpi-card">
                  <div class="ess-kpi-top">
                    <span class="ess-kpi-label">${t.name}</span>
                    <span class="ess-kpi-icon">${t.code === 'SL' ? '🩺' : t.code === 'EL' ? '🌴' : '🏖️'}</span>
                  </div>
                  <div class="ess-kpi-val">${b.available != null ? b.available : 'Uncapped'} <span style="font-size:13px;font-weight:500;">avail</span></div>
                  <div class="ess-kpi-sub">
                    Allocated: ${b.allocated != null ? b.allocated : '—'} · Used: ${b.used} · Pending: ${b.pending}
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <!-- APPLICATIONS HISTORY -->
          <div class="card">
            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
              <div class="card-title">Leave Applications History</div>
              <div style="font-size:12px;color:var(--ess-text-muted);">${applications.length} requests on file</div>
            </div>
            <div class="card-body">
              ${applications.length === 0 ? `
                <div style="text-align:center;padding:32px;color:var(--ess-text-muted);">
                  <div style="font-size:32px;margin-bottom:8px;">🏖️</div>
                  <div>No leave applications submitted yet.</div>
                </div>
              ` : `
                <table class="table" style="font-size:13px;">
                  <thead>
                    <tr>
                      <th>Ref ID</th>
                      <th>Type</th>
                      <th>Dates</th>
                      <th>Days</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th>Submitted On</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${applications.map(a => `
                      <tr>
                        <td><strong>${a.id}</strong></td>
                        <td><span class="ess-role-badge">${a.type}</span></td>
                        <td>${ESS.T.date(a.startDate)} to ${ESS.T.date(a.endDate)}</td>
                        <td>${a.days} ${a.halfDay ? `(${a.halfDay})` : ''}</td>
                        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Utils.escapeHtml(a.reason)}">
                          ${Utils.escapeHtml(a.reason)}
                        </td>
                        <td>
                          <span class="status-badge ${a.status === 'Approved' ? 'confirmed' : a.status === 'Rejected' ? 'terminated' : 'probation'}">
                            ${a.status}
                          </span>
                        </td>
                        <td>${ESS.T.date(a.createdAt)}</td>
                        <td>
                          <div style="display:flex;gap:6px;">
                            <button class="btn btn-xs btn-outline" onclick="ESS.UI.viewRequestTimeline('leave', '${a.id}')">Timeline</button>
                            ${(a.status === 'Approved' || ESS.Flow.isPending(a.status)) ? `
                              <button class="btn btn-xs btn-danger" onclick="ESS.UI.cancelRequest('leave', '${a.id}')">Cancel</button>
                            ` : ''}
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `}
            </div>
          </div>
        </div>
      `;
    },

    openApplyLeaveModal(empCode) {
      const today = ESS.T.today();
      const emp = ESS.Org.get(empCode);
      const mgr = ESS.Org.managerOf(empCode);

      App.showModal(
        'Apply for Leave',
        `
          <div style="font-size:13px;">
            <div style="padding:10px 14px;background:var(--ess-forest-bg);border:1px solid var(--ess-forest-border);border-radius:var(--ess-radius-sm);margin-bottom:16px;">
              Approver Route: <strong>${mgr ? mgr.EmployeeName : 'HR Department (Direct)'}</strong> → HR Administration
            </div>

            <div class="form-group">
              <label>Leave Type</label>
              <select id="levType" onchange="ESS.UI.onLeaveTypeChange(this.value, '${empCode}')">
                ${ESS.Leave.TYPES.map(t => `<option value="${t.code}">${t.name} (${t.code})</option>`).join('')}
              </select>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label>From Date</label>
                <input type="date" id="levStart" value="${today}" onchange="ESS.UI.calcLeaveDays('${empCode}')">
              </div>
              <div class="form-group">
                <label>To Date</label>
                <input type="date" id="levEnd" value="${today}" onchange="ESS.UI.calcLeaveDays('${empCode}')">
              </div>
            </div>

            <div id="levHalfDaySection" style="margin-bottom:12px;">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="levIsHalfDay" onchange="ESS.UI.onHalfDayToggle('${empCode}')">
                <span>Half-day leave</span>
              </label>
              <div id="levHalfDaySelect" style="display:none;margin-top:8px;">
                <select id="levHalfDayPeriod">
                  <option value="First Half">First Half (Morning Session)</option>
                  <option value="Second Half">Second Half (Afternoon Session)</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <div id="levDaysCalcNotice" style="font-weight:600;color:var(--ess-forest);margin-bottom:6px;">
                Calculated Working Days: 1 day (Excludes configured holidays & weekly offs)
              </div>
            </div>

            <div class="form-group">
              <label>Reason for Leave (Mandatory)</label>
              <textarea id="levReason" rows="3" placeholder="Provide details regarding the reason for leave..."></textarea>
            </div>

            <div class="form-group" id="levAttachmentBox">
              <label>Supporting Document (Optional / Required for SL > 2 days)</label>
              <input type="file" id="levFile" accept=".pdf,.jpg,.jpeg,.png">
            </div>
          </div>
        `,
        `
          <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="ESS.UI.submitLeaveApplication('${empCode}')">Submit Leave Application</button>
        `,
        true
      );
    },

    async calcLeaveDays(empCode) {
      const start = document.getElementById('levStart').value;
      const end = document.getElementById('levEnd').value;
      const isHalf = document.getElementById('levIsHalfDay').checked;
      const notice = document.getElementById('levDaysCalcNotice');

      if (!start || !end || start > end) {
        notice.textContent = 'Invalid date range selected.';
        notice.style.color = 'var(--danger)';
        return;
      }

      const days = await ESS.Leave.calculateWorkingDays(empCode, start, end, isHalf);
      notice.textContent = `Calculated Working Days: ${days} day(s) (Excludes holidays & weekly offs)`;
      notice.style.color = 'var(--ess-forest)';
    },

    onLeaveTypeChange(type, empCode) {
      this.calcLeaveDays(empCode);
    },

    onHalfDayToggle(empCode) {
      const isHalf = document.getElementById('levIsHalfDay').checked;
      const sel = document.getElementById('levHalfDaySelect');
      sel.style.display = isHalf ? 'block' : 'none';
      if (isHalf) {
        document.getElementById('levEnd').value = document.getElementById('levStart').value;
      }
      this.calcLeaveDays(empCode);
    },

    async submitLeaveApplication(empCode) {
      const type = document.getElementById('levType').value;
      const startDate = document.getElementById('levStart').value;
      const endDate = document.getElementById('levEnd').value;
      const isHalfDay = document.getElementById('levIsHalfDay').checked;
      const halfDayPeriod = document.getElementById('levHalfDayPeriod') ? document.getElementById('levHalfDayPeriod').value : null;
      const reason = document.getElementById('levReason').value;
      const fileInput = document.getElementById('levFile');

      try {
        let attachmentId = null;
        if (fileInput && fileInput.files && fileInput.files[0]) {
          const fileRec = await ESS.Expense.uploadReceipt(fileInput.files[0], empCode);
          attachmentId = fileRec.id;
        }

        const res = await ESS.Leave.apply({
          empCode,
          type,
          startDate,
          endDate,
          isHalfDay,
          halfDayPeriod,
          reason,
          attachmentFileId: attachmentId
        });

        App.closeModal();
        App.showToast(`Leave application submitted successfully (Ref: ${res.app.id})`, 'success');
        this.openEmailDraftModal(res.emailDraft.id);
        App.navigate('ess-leave');
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    },

    /* ---------------------------------------------------------------------- */
    /* 4. HOLIDAYS & INTEGRATED CALENDAR (ess-calendar)                       */
    /* ---------------------------------------------------------------------- */
    async renderCalendar(container) {
      const actor = ESS.Auth.actor();
      const empCode = actor && actor.emp ? actor.code : 'PRI014';
      const year = new Date().getFullYear();
      const holidays = await ESS.Holidays.getForEmployee(empCode, year);

      container.innerHTML = `
        <div class="ess-container">
          <div class="ess-header-bar">
            <div>
              <div class="ess-title">📅 Company Holidays & Integrated Calendar</div>
              <div class="ess-subtitle">Official Primus Remedies holidays, regional office observances, and integrated event agenda.</div>
            </div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-sm btn-outline active" id="btnCalAgenda">Holidays List</button>
            </div>
          </div>

          <!-- HOLIDAYS DIRECTORY -->
          <div class="card">
            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
              <div class="card-title">Official Holiday Calendar — ${year}</div>
              <input type="text" id="holidaySearchInput" placeholder="Search holidays..." style="width:220px;" oninput="ESS.UI.filterHolidays(this.value)">
            </div>
            <div class="card-body">
              <table class="table" style="font-size:13px;" id="holidayTable">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Weekday</th>
                    <th>Holiday Name</th>
                    <th>Category</th>
                    <th>Applicable Office / Region</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  ${holidays.map(h => `
                    <tr class="holiday-row">
                      <td><strong>${ESS.T.date(h.date)}</strong></td>
                      <td>${h.weekday}</td>
                      <td><strong>${Utils.escapeHtml(h.name)}</strong></td>
                      <td><span class="status-badge confirmed">${h.category}</span></td>
                      <td>${h.office}</td>
                      <td style="color:var(--ess-text-secondary);">${h.description || '—'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    },

    filterHolidays(q) {
      const term = (q || '').toLowerCase();
      document.querySelectorAll('.holiday-row').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(term) ? '' : 'none';
      });
    },

    /* ---------------------------------------------------------------------- */
    /* 5. EXPENSE MANAGEMENT SCREEN (ess-expenses)                            */
    /* ---------------------------------------------------------------------- */
    async renderExpenses(container) {
      const actor = ESS.Auth.actor();
      if (!actor || !actor.emp) {
        container.innerHTML = `<div class="ess-container"><div class="card" style="padding:24px;">Please select an employee persona to manage expenses.</div></div>`;
        return;
      }

      const emp = actor.emp;
      const metrics = await ESS.Expense.getMetrics(emp.EmployeeCode);
      const claims = await ESS.Expense.getEmployeeClaims(emp.EmployeeCode);

      container.innerHTML = `
        <div class="ess-container">
          <div class="ess-header-bar">
            <div>
              <div class="ess-title">💳 My Expense Claims</div>
              <div class="ess-subtitle">Submit reimbursement claims, upload receipt vouchers, and track manager & finance approval.</div>
            </div>
            <button class="btn btn-primary" onclick="ESS.UI.openExpenseModal('${emp.EmployeeCode}')">
              + New Expense Claim
            </button>
          </div>

          <!-- METRICS -->
          <div class="ess-kpi-grid">
            <div class="ess-kpi-card">
              <div class="ess-kpi-top">
                <span class="ess-kpi-label">Total Submitted</span>
                <span class="ess-kpi-icon">📝</span>
              </div>
              <div class="ess-kpi-val">${ESS.inr(metrics.submitted)}</div>
              <div class="ess-kpi-sub">${metrics.totalClaimsCount} claim(s) filed</div>
            </div>

            <div class="ess-kpi-card">
              <div class="ess-kpi-top">
                <span class="ess-kpi-label">Pending Approval</span>
                <span class="ess-kpi-icon">⏳</span>
              </div>
              <div class="ess-kpi-val">${ESS.inr(metrics.pending)}</div>
              <div class="ess-kpi-sub">In approval workflow</div>
            </div>

            <div class="ess-kpi-card">
              <div class="ess-kpi-top">
                <span class="ess-kpi-label">Approved (Pending Pay)</span>
                <span class="ess-kpi-icon">✅</span>
              </div>
              <div class="ess-kpi-val">${ESS.inr(metrics.approved)}</div>
              <div class="ess-kpi-sub">Ready for reimbursement</div>
            </div>

            <div class="ess-kpi-card">
              <div class="ess-kpi-top">
                <span class="ess-kpi-label">Reimbursed</span>
                <span class="ess-kpi-icon">💰</span>
              </div>
              <div class="ess-kpi-val" style="color:var(--ess-forest);">${ESS.inr(metrics.reimbursed)}</div>
              <div class="ess-kpi-sub">Disbursed to bank account</div>
            </div>
          </div>

          <!-- CLAIMS TABLE -->
          <div class="card">
            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
              <div class="card-title">Claims & Reimbursement History</div>
            </div>
            <div class="card-body">
              ${claims.length === 0 ? `
                <div style="text-align:center;padding:32px;color:var(--ess-text-muted);">
                  <div style="font-size:32px;margin-bottom:8px;">💳</div>
                  <div>No expense claims submitted yet. Click "+ New Expense Claim" to submit.</div>
                </div>
              ` : `
                <table class="table" style="font-size:13px;">
                  <thead>
                    <tr>
                      <th>Claim ID</th>
                      <th>Expense Date</th>
                      <th>Title</th>
                      <th>Category</th>
                      <th>Amount</th>
                      <th>Receipts</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${claims.map(c => `
                      <tr>
                        <td><strong>${c.id}</strong></td>
                        <td>${ESS.T.date(c.expenseDate)}</td>
                        <td><strong>${Utils.escapeHtml(c.title)}</strong></td>
                        <td><span class="ess-role-badge">${c.category}</span></td>
                        <td><strong>${ESS.inr(c.amount)}</strong></td>
                        <td>${(c.receiptIds || []).length} attached</td>
                        <td>
                          <span class="status-badge ${c.status === 'Reimbursed' ? 'confirmed' : c.status === 'Approved' ? 'confirmed' : c.status === 'Rejected' ? 'terminated' : 'probation'}">
                            ${c.status}
                          </span>
                        </td>
                        <td>
                          <div style="display:flex;gap:6px;">
                            ${c.status === 'Draft' ? `
                              <button class="btn btn-xs btn-primary" onclick="ESS.UI.submitDraftClaim('${c.id}')">Submit</button>
                              <button class="btn btn-xs btn-outline" onclick="ESS.UI.openExpenseModal('${c.EmployeeCode}', '${c.id}')">Edit</button>
                              <button class="btn btn-xs btn-danger" onclick="ESS.UI.deleteDraftClaim('${c.id}')">Delete</button>
                            ` : `
                              <button class="btn btn-xs btn-outline" onclick="ESS.UI.viewRequestTimeline('expense', '${c.id}')">Timeline</button>
                              ${ESS.Flow.isPending(c.status) ? `
                                <button class="btn btn-xs btn-danger" onclick="ESS.UI.cancelRequest('expense', '${c.id}')">Withdraw</button>
                              ` : ''}
                            `}
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `}
            </div>
          </div>
        </div>
      `;
    },

    async openExpenseModal(empCode, existingId) {
      let claim = null;
      if (existingId) {
        claim = await ESS.Data.get(S.claims, existingId);
      }

      const cfg = ESS.Settings.get().expense;
      const categories = (cfg.categories || []).map(c => c.name);
      const today = ESS.T.today();

      App.showModal(
        claim ? 'Edit Expense Claim' : 'Submit New Expense Claim',
        `
          <div style="font-size:13px;">
            <div class="form-group">
              <label>Claim Title / Subject</label>
              <input type="text" id="expTitle" value="${claim ? Utils.escapeHtml(claim.title) : ''}" placeholder="e.g. Hyderabad Doctor Visit Travel Expenses">
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label>Category</label>
                <select id="expCategory">
                  ${categories.map(c => `<option value="${c}" ${claim && claim.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Expense Date</label>
                <input type="date" id="expDate" value="${claim ? claim.expenseDate : today}" max="${today}">
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label>Amount in INR (₹)</label>
                <input type="number" id="expAmount" step="0.01" value="${claim ? claim.amount : ''}" placeholder="0.00">
              </div>
              <div class="form-group">
                <label>Payment Mode</label>
                <select id="expPayMode">
                  <option value="Cash">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="Card">Credit/Debit Card</option>
                  <option value="Company Card">Company Card</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label>Business Purpose</label>
              <textarea id="expPurpose" rows="2" placeholder="Explain the business objective of this expenditure...">${claim ? Utils.escapeHtml(claim.purpose) : ''}</textarea>
            </div>

            <div class="form-group">
              <label>Upload Receipt / Tax Invoice (PDF, JPG, PNG)</label>
              <input type="file" id="expReceiptFile" accept=".pdf,.jpg,.jpeg,.png">
            </div>
          </div>
        `,
        `
          <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
          <button class="btn btn-secondary" onclick="ESS.UI.saveExpenseDraft('${empCode}', '${existingId || ''}')">Save Draft</button>
          <button class="btn btn-primary" onclick="ESS.UI.saveAndSubmitExpense('${empCode}', '${existingId || ''}')">Submit for Approval</button>
        `,
        true
      );
    },

    async saveExpenseDraft(empCode, existingId) {
      try {
        const title = document.getElementById('expTitle').value;
        const category = document.getElementById('expCategory').value;
        const expenseDate = document.getElementById('expDate').value;
        const amount = document.getElementById('expAmount').value;
        const purpose = document.getElementById('expPurpose').value;
        const paymentMethod = document.getElementById('expPayMode').value;
        const fileInput = document.getElementById('expReceiptFile');

        let receiptIds = [];
        if (fileInput && fileInput.files && fileInput.files[0]) {
          const fileRec = await ESS.Expense.uploadReceipt(fileInput.files[0], empCode);
          receiptIds.push(fileRec.id);
        }

        await ESS.Expense.saveDraft({
          id: existingId || null,
          empCode,
          title,
          category,
          expenseDate,
          amount,
          purpose,
          receiptIds,
          paymentMethod
        });

        App.closeModal();
        App.showToast('Expense claim saved as draft.', 'success');
        App.navigate('ess-expenses');
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    },

    async saveAndSubmitExpense(empCode, existingId) {
      try {
        const title = document.getElementById('expTitle').value;
        const category = document.getElementById('expCategory').value;
        const expenseDate = document.getElementById('expDate').value;
        const amount = document.getElementById('expAmount').value;
        const purpose = document.getElementById('expPurpose').value;
        const paymentMethod = document.getElementById('expPayMode').value;
        const fileInput = document.getElementById('expReceiptFile');

        let receiptIds = [];
        if (fileInput && fileInput.files && fileInput.files[0]) {
          const fileRec = await ESS.Expense.uploadReceipt(fileInput.files[0], empCode);
          receiptIds.push(fileRec.id);
        }

        const draft = await ESS.Expense.saveDraft({
          id: existingId || null,
          empCode,
          title,
          category,
          expenseDate,
          amount,
          purpose,
          receiptIds,
          paymentMethod
        });

        const res = await ESS.Expense.submit(draft.id);
        App.closeModal();
        App.showToast(`Expense claim ${res.claim.id} submitted for approval.`, 'success');
        this.openEmailDraftModal(res.emailDraft.id);
        App.navigate('ess-expenses');
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    },

    async submitDraftClaim(id) {
      try {
        const res = await ESS.Expense.submit(id);
        App.showToast(`Expense claim ${id} submitted for approval.`, 'success');
        this.openEmailDraftModal(res.emailDraft.id);
        App.navigate('ess-expenses');
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    },

    async deleteDraftClaim(id) {
      App.showConfirmDialog('Are you sure you want to permanently delete this draft expense claim?', async () => {
        try {
          await ESS.Expense.deleteDraft(id);
          App.showToast('Draft claim deleted.', 'info');
          App.navigate('ess-expenses');
        } catch (err) {
          App.showToast(err.message, 'error');
        }
      });
    },

    /* ---------------------------------------------------------------------- */
    /* 6. SECURE DOCUMENT VAULT (ess-documents)                               */
    /* ---------------------------------------------------------------------- */
    async renderDocuments(container) {
      const actor = ESS.Auth.actor();
      if (!actor || !actor.emp) {
        container.innerHTML = `<div class="ess-container"><div class="card" style="padding:24px;">Please select an employee persona to access the document vault.</div></div>`;
        return;
      }

      const emp = actor.emp;
      const docs = await ESS.Documents.getEmployeeDocuments(emp.EmployeeCode);

      container.innerHTML = `
        <div class="ess-container">
          <div class="ess-header-bar">
            <div>
              <div class="ess-title">📁 Secure HR Document Vault</div>
              <div class="ess-subtitle">Access authorized company documents, salary slips, appointment letters, and Form 16.</div>
            </div>
            ${ESS.Auth.can('admin.documents') ? `
              <button class="btn btn-primary" onclick="ESS.UI.openUploadDocModal('${emp.EmployeeCode}')">
                + Upload HR Document
              </button>
            ` : ''}
          </div>

          <!-- CATEGORY PILLS -->
          <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:12px;margin-bottom:16px;">
            <button class="btn btn-sm btn-outline active doc-filter-btn" onclick="ESS.UI.filterDocs('all', this)">All Documents</button>
            ${ESS.Documents.CATEGORIES.map(c => `
              <button class="btn btn-sm btn-outline doc-filter-btn" onclick="ESS.UI.filterDocs('${c}', this)">${c}</button>
            `).join('')}
          </div>

          <!-- DOCUMENT CARDS GRID -->
          <div class="ess-doc-grid" id="essDocGrid">
            ${docs.length === 0 ? `
              <div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--ess-text-muted);background:var(--ess-card-bg);border:1px dashed var(--ess-border);border-radius:var(--ess-radius-lg);">
                <div style="font-size:40px;margin-bottom:12px;">📄</div>
                <div style="font-size:16px;font-weight:600;color:var(--ess-charcoal);">No Documents Available</div>
                <p style="margin-top:6px;">Your authorized letters, appointment agreements, and Form 16 will appear here once published by HR.</p>
              </div>
            ` : docs.map(d => `
              <div class="ess-doc-card" data-category="${d.category}">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                    <span class="ess-role-badge">${d.category}</span>
                    <span style="font-size:11px;color:var(--ess-text-light);">${ESS.T.date(d.createdAt)}</span>
                  </div>
                  <div style="font-size:15px;font-weight:700;color:var(--ess-charcoal);margin-bottom:4px;">
                    ${Utils.escapeHtml(d.title)}
                  </div>
                  ${d.financialYear ? `<div style="font-size:12px;color:var(--ess-forest);font-weight:600;">FY: ${d.financialYear}</div>` : ''}
                  <div style="font-size:12px;color:var(--ess-text-secondary);margin-top:4px;">
                    File: ${d.fileName} (${Math.round((d.fileSize || 0) / 1024)} KB)
                  </div>
                </div>

                <div style="margin-top:16px;display:flex;gap:8px;">
                  <button class="btn btn-xs btn-primary" onclick="ESS.UI.previewDocument('${d.id}')">
                    👁️ View & Preview
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    },

    filterDocs(cat, btn) {
      document.querySelectorAll('.doc-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.ess-doc-card').forEach(card => {
        if (cat === 'all' || card.dataset.category === cat) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });
    },

    async previewDocument(docId) {
      try {
        const { doc, file } = await ESS.Documents.fetchDocumentWithData(docId);
        let previewHtml = '';

        if (file.type === 'application/pdf') {
          previewHtml = `
            <iframe src="${file.data}" style="width:100%;height:500px;border:none;border-radius:8px;"></iframe>
          `;
        } else if (file.type.startsWith('image/')) {
          previewHtml = `
            <div style="text-align:center;padding:12px;">
              <img src="${file.data}" style="max-width:100%;max-height:500px;border-radius:8px;box-shadow:var(--ess-shadow-sm);">
            </div>
          `;
        } else {
          previewHtml = `
            <div style="padding:24px;text-align:center;">
              <div style="font-size:36px;margin-bottom:8px;">📄</div>
              <div>${file.name} (${Math.round(file.size / 1024)} KB)</div>
              <p style="color:var(--ess-text-muted);font-size:13px;margin:12px 0;">Binary document ready for download.</p>
            </div>
          `;
        }

        App.showModal(
          `${doc.title} — ${doc.category}`,
          `
            <div>
              <div style="font-size:12px;color:var(--ess-text-muted);margin-bottom:12px;">
                Issued to: <strong>${doc.EmployeeCode} (${doc.employeeName})</strong> · Uploaded on: ${ESS.T.dateTime(doc.createdAt)}
              </div>
              ${previewHtml}
            </div>
          `,
          `
            <button class="btn btn-outline" onclick="App.closeModal()">Close</button>
            <a class="btn btn-primary" href="${file.data}" download="${file.name}">⬇ Download File</a>
          `,
          true
        );
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    },

    openUploadDocModal(defaultEmpCode) {
      App.showModal(
        'Upload HR Document to Employee Vault',
        `
          <div style="font-size:13px;">
            <div class="form-group">
              <label>Employee Code</label>
              <input type="text" id="docUploadEmpCode" value="${defaultEmpCode}">
            </div>
            <div class="form-group">
              <label>Document Title</label>
              <input type="text" id="docUploadTitle" placeholder="e.g. Appointment Letter - Territory Business Manager">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label>Category</label>
                <select id="docUploadCategory">
                  ${ESS.Documents.CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Financial Year (if applicable)</label>
                <input type="text" id="docUploadFY" placeholder="e.g. 2025-26">
              </div>
            </div>
            <div class="form-group">
              <label>Select File (PDF, DOCX, JPG)</label>
              <input type="file" id="docUploadFile" accept=".pdf,.jpg,.jpeg,.png,.docx,.doc">
            </div>
          </div>
        `,
        `
          <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="ESS.UI.executeDocUpload()">Upload Document</button>
        `
      );
    },

    async executeDocUpload() {
      try {
        const empCode = document.getElementById('docUploadEmpCode').value;
        const title = document.getElementById('docUploadTitle').value;
        const category = document.getElementById('docUploadCategory').value;
        const financialYear = document.getElementById('docUploadFY').value;
        const fileInput = document.getElementById('docUploadFile');

        if (!fileInput.files || !fileInput.files[0]) {
          throw new ESS.Error('Please select a file to upload.');
        }

        await ESS.Documents.upload({
          empCode,
          title,
          category,
          financialYear,
          file: fileInput.files[0]
        });

        App.closeModal();
        App.showToast('Document uploaded successfully to employee vault.', 'success');
        App.navigate('ess-documents');
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    },

    /* ---------------------------------------------------------------------- */
    /* 7. MANAGER & HR APPROVALS CENTRE (ess-approvals)                       */
    /* ---------------------------------------------------------------------- */
    async renderApprovals(container) {
      const actor = ESS.Auth.actor();
      const pending = await ESS.Approvals.getPendingForActor();
      const history = await ESS.Approvals.getDecisionHistory();

      container.innerHTML = `
        <div class="ess-container">
          <div class="ess-header-bar">
            <div>
              <div class="ess-title">✅ Approval Centre</div>
              <div class="ess-subtitle">Role-segregated approval queue for Reporting Managers, HR, and Finance.</div>
            </div>
          </div>

          <!-- PENDING QUEUES -->
          <div class="card" style="margin-bottom:24px;">
            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
              <div class="card-title">Pending Action Items (${pending.totalCount})</div>
            </div>
            <div class="card-body">
              ${pending.totalCount === 0 ? `
                <div style="text-align:center;padding:32px;color:var(--ess-text-muted);">
                  <div style="font-size:32px;margin-bottom:8px;">🎉</div>
                  <div>No pending approvals awaiting your review.</div>
                </div>
              ` : `
                <table class="table" style="font-size:13px;">
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th>Ref ID</th>
                      <th>Employee</th>
                      <th>Summary</th>
                      <th>Current Stage</th>
                      <th>Submitted On</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${pending.leaves.map(l => `
                      <tr>
                        <td><span class="status-badge" style="background:#ccfbf1;color:#115e59;">Leave</span></td>
                        <td><strong>${l.id}</strong></td>
                        <td>${l.employeeName} (${l.EmployeeCode})</td>
                        <td>${l.type} · ${l.days} day(s) (${ESS.T.date(l.startDate)})</td>
                        <td><span class="status-badge warning">${l.status}</span></td>
                        <td>${ESS.T.date(l.createdAt)}</td>
                        <td>
                          <div style="display:flex;gap:4px;">
                            <button class="btn btn-xs btn-primary" onclick="ESS.UI.openDecisionModal('leave', '${l.id}', 'approve')">Approve</button>
                            <button class="btn btn-xs btn-warning" onclick="ESS.UI.openDecisionModal('leave', '${l.id}', 'return')">Return</button>
                            <button class="btn btn-xs btn-danger" onclick="ESS.UI.openDecisionModal('leave', '${l.id}', 'reject')">Reject</button>
                          </div>
                        </td>
                      </tr>
                    `).join('')}

                    ${pending.expenses.map(e => `
                      <tr>
                        <td><span class="status-badge" style="background:#fef3c7;color:#92400e;">Expense</span></td>
                        <td><strong>${e.id}</strong></td>
                        <td>${e.employeeName} (${e.EmployeeCode})</td>
                        <td><strong>${ESS.inr(e.amount)}</strong> · ${e.title}</td>
                        <td><span class="status-badge warning">${e.status}</span></td>
                        <td>${ESS.T.date(e.createdAt)}</td>
                        <td>
                          <div style="display:flex;gap:4px;">
                            <button class="btn btn-xs btn-primary" onclick="ESS.UI.openDecisionModal('expense', '${e.id}', 'approve')">Approve</button>
                            <button class="btn btn-xs btn-warning" onclick="ESS.UI.openDecisionModal('expense', '${e.id}', 'return')">Return</button>
                            <button class="btn btn-xs btn-danger" onclick="ESS.UI.openDecisionModal('expense', '${e.id}', 'reject')">Reject</button>
                          </div>
                        </td>
                      </tr>
                    `).join('')}

                    ${pending.corrections.map(c => `
                      <tr>
                        <td><span class="status-badge" style="background:#e0e7ff;color:#3730a3;">Punch Correction</span></td>
                        <td><strong>${c.id}</strong></td>
                        <td>${c.EmployeeCode}</td>
                        <td>${ESS.T.date(c.date)}: ${c.reason}</td>
                        <td><span class="status-badge warning">${c.status}</span></td>
                        <td>${ESS.T.date(c.createdAt)}</td>
                        <td>
                          <div style="display:flex;gap:4px;">
                            <button class="btn btn-xs btn-primary" onclick="ESS.UI.openDecisionModal('correction', '${c.id}', 'approve')">Approve</button>
                            <button class="btn btn-xs btn-danger" onclick="ESS.UI.openDecisionModal('correction', '${c.id}', 'reject')">Reject</button>
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `}
            </div>
          </div>

          <!-- RECENT DECISIONS AUDIT -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Recent Decision History (${history.length})</div>
            </div>
            <div class="card-body">
              <table class="table" style="font-size:13px;">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>Ref ID</th>
                    <th>Employee</th>
                    <th>Decision Maker</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  ${history.map(h => `
                    <tr>
                      <td>${ESS.T.dateTime(h.At)}</td>
                      <td><span class="status-badge ${h.Action === 'approve' ? 'confirmed' : 'terminated'}">${h.Action.toUpperCase()}</span></td>
                      <td><strong>${h.RequestId}</strong></td>
                      <td>${h.EmployeeCode}</td>
                      <td>${h.ActorName}</td>
                      <td style="color:var(--ess-text-secondary);">${h.Remarks || '—'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    },

    openDecisionModal(kind, id, action) {
      const verb = { approve: 'Approve', reject: 'Reject', return: 'Return for Correction' }[action];
      const requiresRemarks = action !== 'approve';

      App.showModal(
        `${verb} Request ${id}`,
        `
          <div style="font-size:13px;">
            <p style="margin-bottom:12px;">
              You are about to <strong>${verb.toLowerCase()}</strong> this ${kind} request.
            </p>
            <div class="form-group">
              <label>Reviewer Remarks ${requiresRemarks ? '<span style="color:red">* (Mandatory)</span>' : '(Optional)'}</label>
              <textarea id="decRemarks" rows="3" placeholder="Enter remarks, feedback, or justification..."></textarea>
            </div>
          </div>
        `,
        `
          <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
          <button class="btn ${action === 'approve' ? 'btn-primary' : action === 'return' ? 'btn-warning' : 'btn-danger'}" onclick="ESS.UI.executeDecision('${kind}', '${id}', '${action}')">
            Confirm ${verb}
          </button>
        `
      );
    },

    async executeDecision(kind, id, action) {
      try {
        const remarks = document.getElementById('decRemarks').value;
        const res = await ESS.Approvals.decide(kind, id, action, remarks);

        App.closeModal();
        App.showToast(`Request ${id} ${action}d successfully.`, 'success');

        // If an email draft was created, prompt user
        if (res.drafts && res.drafts[0]) {
          this.openEmailDraftModal(res.drafts[0].id);
        }
        App.navigate('ess-approvals');
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    },

    /* ---------------------------------------------------------------------- */
    /* 8. COMMON MODALS: EMAIL DRAFT & TIMELINE                               */
    /* ---------------------------------------------------------------------- */
    async openEmailDraftModal(emailId) {
      const draft = await ESS.Email.get(emailId);
      if (!draft) return;

      const hasSecureLink = !!draft.secureLink;
      const isDelivered = draft.status === 'delivered' || draft.state === 'delivered';
      const expiresText = draft.linkExpiresAt ? new Date(draft.linkExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + new Date(draft.linkExpiresAt).toLocaleDateString() : '24 hours';

      let noticeHtml = '';
      if (isDelivered) {
        noticeHtml = `
          <div class="ess-notice-badge success" style="margin-bottom:12px;width:100%;background:rgba(34,197,94,0.12);color:#22c55e;padding:10px 12px;border-radius:6px;border:1px solid rgba(34,197,94,0.3);">
            ✅ <strong>Email Automatically Sent:</strong> A secure 24-hour approval link has been delivered directly to the approver.
          </div>`;
      } else if (hasSecureLink) {
        noticeHtml = `
          <div class="ess-notice-badge info" style="margin-bottom:12px;width:100%;background:rgba(59,130,246,0.12);color:#60a5fa;padding:10px 12px;border-radius:6px;border:1px solid rgba(59,130,246,0.3);">
            🔗 <strong>24-Hour Approval Link Generated:</strong> This notification contains a secure one-click link valid until <strong>${Utils.escapeHtml(expiresText)}</strong> allowing the approver (Manager / HR) to approve or reject directly from their email.
            ${draft.needsRecipient ? '<div style="margin-top:4px;color:#f59e0b;">⚠️ Please verify the approver\'s email address in the "To:" field below.</div>' : ''}
          </div>`;
      } else {
        noticeHtml = `
          <div class="ess-notice-badge info" style="margin-bottom:12px;width:100%;">
            This email notification has been pre-drafted. You may review or edit it before opening it in your default mail application.
          </div>`;
      }

      App.showModal(
        `✉️ Email Notification Draft (${draft.requestId})`,
        `
          <div style="font-size:13px;">
            ${noticeHtml}

            <div class="ess-email-draft-box">
              <div class="ess-email-field">
                <label>To:</label>
                <input type="text" id="emTo" value="${Utils.escapeHtml(draft.to || '')}">
              </div>
              ${draft.cc ? `
                <div class="ess-email-field">
                  <label>Cc:</label>
                  <input type="text" id="emCc" value="${Utils.escapeHtml(draft.cc || '')}">
                </div>
              ` : ''}
              <div class="ess-email-field">
                <label>Subject:</label>
                <input type="text" id="emSubject" value="${Utils.escapeHtml(draft.subject || '')}">
              </div>
              <div style="margin-top:10px;">
                <label style="font-weight:600;color:var(--ess-text-muted);display:block;margin-bottom:6px;">Message Body:</label>
                <textarea id="emBody" rows="10" style="width:100%;font-family:monospace;font-size:12px;padding:8px;border:1px solid var(--ess-border);border-radius:4px;">${Utils.escapeHtml(draft.body)}</textarea>
              </div>
            </div>
          </div>
        `,
        `
          <button class="btn btn-outline" onclick="App.closeModal()">Close</button>
          <button class="btn btn-primary" onclick="ESS.UI.sendGmailWeb('${draft.id}')" style="background:#ea4335;border-color:#ea4335;" title="Open in Gmail Web with approval link">
            📧 Send via Gmail
          </button>
          <button class="btn btn-outline" onclick="ESS.UI.sendMailDirect('${draft.id}')" title="Send directly via server SMTP / Gmail">
            🚀 Send via Server
          </button>
          <button class="btn btn-outline" onclick="ESS.UI.sendMailto('${draft.id}')" title="Open in default mail client">
            📫 Default Mail Client
          </button>
        `,
        true
      );
    },

    async sendGmailWeb(emailId) {
      try {
        const to = document.getElementById('emTo').value;
        const cc = document.getElementById('emCc') ? document.getElementById('emCc').value : '';
        const subject = document.getElementById('emSubject').value;
        const body = document.getElementById('emBody').value;
        await ESS.Email.update(emailId, { to, cc, subject, body });

        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}${cc ? '&cc=' + encodeURIComponent(cc) : ''}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(gmailUrl, '_blank');
        App.closeModal();
        App.showToast('Opened Gmail web composer with approval link.', 'success');
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    },

    async sendMailDirect(emailId) {
      try {
        const to = document.getElementById('emTo').value;
        const cc = document.getElementById('emCc') ? document.getElementById('emCc').value : '';
        const subject = document.getElementById('emSubject').value;
        const body = document.getElementById('emBody').value;
        if (!to) {
          App.showToast('Please enter a recipient email address', 'error');
          return;
        }

        const res = await fetch('/api/ess/approvals/send-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, cc, subject, body, emailId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send email');

        await ESS.Email.update(emailId, { to, cc, subject, body, state: 'delivered' });
        App.closeModal();
        if (data.delivered) {
          App.showToast('Email delivered successfully to ' + to + ' via Gmail / SMTP server!', 'success');
        } else {
          App.showToast('Email recorded with 24-hour approval link (' + data.mode + ').', 'info');
        }
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    },

    async sendMailto(emailId) {
      try {
        // Save any edits
        const to = document.getElementById('emTo').value;
        const subject = document.getElementById('emSubject').value;
        const body = document.getElementById('emBody').value;
        await ESS.Email.update(emailId, { to, subject, body });

        await ESS.Email.openMailto(emailId);
        App.closeModal();
        App.showToast('Opened email draft in your system mail client.', 'success');
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    },

    async viewRequestTimeline(kind, id) {
      const rec = await ESS.Flow.get(kind, id);
      if (!rec) return;

      const timeline = rec.timeline || [];

      App.showModal(
        `Approval Timeline — ${rec.id}`,
        `
          <div style="font-size:13px;">
            <div style="margin-bottom:16px;">
              Status: <span class="status-badge ${rec.status === 'Approved' ? 'confirmed' : 'probation'}">${rec.status}</span>
            </div>

            <div class="ess-timeline">
              ${timeline.map(t => `
                <div class="ess-timeline-step">
                  <div class="ess-timeline-dot ${t.status ? t.status.toLowerCase() : ''}"></div>
                  <div class="ess-timeline-content">
                    <div class="ess-timeline-header">
                      <span>${t.action}</span>
                      <span class="ess-timeline-time">${ESS.T.dateTime(t.at)}</span>
                    </div>
                    <div style="color:var(--ess-text-muted);font-size:12px;">By: ${t.actor}</div>
                    ${t.remarks ? `<div class="ess-timeline-remarks">Remarks: ${Utils.escapeHtml(t.remarks)}</div>` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `,
        `
          <button class="btn btn-outline" onclick="App.closeModal()">Close</button>
        `
      );
    },

    async cancelRequest(kind, id) {
      App.showConfirmDialog(`Are you sure you want to cancel ${kind} request ${id}?`, async () => {
        try {
          await ESS.Flow.cancel(kind, id, 'Cancelled by employee');
          App.showToast('Request cancelled.', 'info');
          App.navigate(State.currentPage);
        } catch (err) {
          App.showToast(err.message, 'error');
        }
      });
    },

    /* ---------------------------------------------------------------------- */
    /* 9. NOTIFICATIONS CENTER (ess-notifications)                            */
    /* ---------------------------------------------------------------------- */
    async renderNotifications(container) {
      const notes = await ESS.Notify.mine();

      container.innerHTML = `
        <div class="ess-container">
          <div class="ess-header-bar">
            <div>
              <div class="ess-title">🔔 Notification Centre</div>
              <div class="ess-subtitle">In-app notifications for approvals, reimbursements, attendance exceptions, and HR updates.</div>
            </div>
            <button class="btn btn-outline btn-sm" onclick="ESS.UI.markAllNotesRead()">Mark All as Read</button>
          </div>

          <div class="card">
            <div class="card-body">
              ${notes.length === 0 ? `
                <div style="text-align:center;padding:32px;color:var(--ess-text-muted);">
                  <div style="font-size:32px;margin-bottom:8px;">🔔</div>
                  <div>No notifications on file.</div>
                </div>
              ` : notes.map(n => {
                const isRead = ESS.Notify.isRead(n);
                return `
                  <div style="padding:14px;border-bottom:1px solid var(--ess-border-subtle);display:flex;align-items:flex-start;gap:12px;background:${isRead ? 'transparent' : 'var(--ess-forest-bg)'};border-radius:var(--ess-radius-sm);margin-bottom:8px;">
                    <span style="font-size:20px;">${n.type === 'success' ? '✅' : n.type === 'danger' ? '❌' : 'ℹ️'}</span>
                    <div style="flex:1;">
                      <div style="display:flex;justify-content:space-between;">
                        <span style="font-weight:700;color:var(--ess-charcoal);font-size:14px;">${Utils.escapeHtml(n.title)}</span>
                        <span style="font-size:11px;color:var(--ess-text-light);">${ESS.T.dateTime(n.createdAt)}</span>
                      </div>
                      <div style="font-size:13px;color:var(--ess-text-secondary);margin-top:4px;">${Utils.escapeHtml(n.body)}</div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      `;
    },

    async markAllNotesRead() {
      await ESS.Notify.markAllRead();
      App.showToast('All notifications marked as read.', 'success');
      App.navigate('ess-notifications');
    },

    /* ---------------------------------------------------------------------- */
    /* 10. AUDIT CHAIN VERIFIER & SETTINGS (ess-settings)                     */
    /* ---------------------------------------------------------------------- */
    async renderSettings(container) {
      const cfg = ESS.Settings.get();
      const auditStatus = await ESS.Audit.verify();

      container.innerHTML = `
        <div class="ess-container">
          <div class="ess-header-bar">
            <div>
              <div class="ess-title">⚙️ ESS Administration & Security</div>
              <div class="ess-subtitle">Configure attendance rules, face verification adapters, email integrations, and verify the cryptographic audit chain.</div>
            </div>
          </div>

          <!-- CRYPTOGRAPHIC AUDIT VERIFICATION CARD -->
          <div class="card" style="margin-bottom:24px;">
            <div class="card-header">
              <div class="card-title">🛡️ Tamper-Evident SHA-256 Audit Trail Integrity</div>
            </div>
            <div class="card-body">
              <p style="font-size:13px;color:var(--ess-text-secondary);margin-bottom:16px;">
                Every attendance punch, leave application, expense claim decision, and setting modification is recorded in an immutable, forward-hashed SHA-256 cryptographic chain to prevent silent alteration.
              </p>
              <div style="display:flex;align-items:center;gap:16px;padding:16px;background:${auditStatus.ok ? '#ecfdf5' : '#fef2f2'};border:1px solid ${auditStatus.ok ? '#a7f3d0' : '#fecaca'};border-radius:var(--ess-radius-md);">
                <span style="font-size:32px;">${auditStatus.ok ? '✅' : '❌'}</span>
                <div>
                  <div style="font-size:15px;font-weight:700;color:${auditStatus.ok ? '#065f46' : '#991b1b'};">
                    ${auditStatus.ok ? `Audit Chain Verified Intact (${auditStatus.count} immutable records)` : `Audit Chain Integrity Broken at record #${auditStatus.brokenAt}!`}
                  </div>
                  <div style="font-size:12px;color:var(--ess-text-secondary);margin-top:2px;">
                    Algorithm: SHA-256 hash chaining · Storage: Append-Only IndexedDB ObjectStore
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- INTEGRATION & ADAPTER STATUS -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(360px, 1fr));gap:24px;">
            <!-- Face Verification -->
            <div class="card">
              <div class="card-header"><div class="card-title">Facial Verification Adapter</div></div>
              <div class="card-body" style="font-size:13px;">
                <div class="form-group">
                  <label>Verification Mode</label>
                  <select id="cfgFaceMode" onchange="ESS.UI.saveFaceSettings()">
                    <option value="demo" ${cfg.faceVerification.demoEnabled ? 'selected' : ''}>Demo Mode (Authorized simulation for evaluation)</option>
                    <option value="none" ${!cfg.faceVerification.demoEnabled && cfg.faceVerification.mode === 'none' ? 'selected' : ''}>None (Unconfigured - Blocks punches)</option>
                    <option value="remote" ${cfg.faceVerification.mode === 'remote' ? 'selected' : ''}>Remote Enterprise Service (AWS/Azure/GCP)</option>
                  </select>
                </div>
                <div style="font-size:12px;color:var(--ess-text-muted);margin-top:8px;">
                  Note: Camera frames are NEVER saved to IndexedDB or localStorage. Verification is ephemeral.
                </div>
              </div>
            </div>

            <!-- Email Settings -->
            <div class="card">
              <div class="card-header"><div class="card-title">Email Notifications</div></div>
              <div class="card-body" style="font-size:13px;">
                <div class="form-group">
                  <label>Delivery Mode</label>
                  <select id="cfgEmailMode">
                    <option value="mailto" selected>Mailto Client (Standard local desktop & mobile mail client)</option>
                    <option value="remote">Remote SMTP / API Service</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>HR Recipient Email</label>
                  <input type="email" id="cfgHrEmail" value="${cfg.email.hrEmail || 'hr@primusremedies.com'}">
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    },

    async saveFaceSettings() {
      const mode = document.getElementById('cfgFaceMode').value;
      await ESS.Settings.update('faceVerification', {
        mode: mode === 'remote' ? 'remote' : 'demo',
        demoEnabled: mode === 'demo',
        endpoint: '',
        authHeader: '',
        tested: false
      }, 'Updated face verification mode to ' + mode);
      App.showToast(`Updated face verification setting to ${mode}`, 'success');
    }
  };
})(window);
