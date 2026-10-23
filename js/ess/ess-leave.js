/* ==========================================================================
   PRIMUS REMEDIES — ESS — LEAVE MANAGEMENT MODULE
   Leave types: CL, SL, EL, LOP, C-Off • Real balance tracking •
   Working days calculator excluding holidays & weekly offs •
   Overlap prevention • Approval workflow • Email draft generation •
   Cancellation rules.
   ========================================================================== */
(function (global) {
  'use strict';
  const ESS = (global.ESS = global.ESS || {});
  const S = ESS.S;

  ESS.Leave = {
    TYPES: [
      { code: 'CL', name: 'Casual Leave', allowsHalfDay: true, requiresAttachment: false, description: 'Short notice or personal matters' },
      { code: 'SL', name: 'Sick Leave', allowsHalfDay: true, requiresAttachment: true, attachmentThresholdDays: 2, description: 'Illness or medical recovery' },
      { code: 'EL', name: 'Earned / Privilege Leave', allowsHalfDay: false, requiresAttachment: false, description: 'Planned annual leave' },
      { code: 'LOP', name: 'Loss of Pay', allowsHalfDay: true, requiresAttachment: false, description: 'Leave without pay when balances exhausted' },
      { code: 'C-Off', name: 'Compensatory Off', allowsHalfDay: true, requiresAttachment: false, description: 'Compensatory time for work on holidays/weekends' }
    ],

    /**
     * Initializes default leave policies in database if not present.
     */
    async initPolicies() {
      const existing = await ESS.Data.getAll(S.leavePolicies);
      if (existing && existing.length > 0) return existing;

      const defaults = [
        { code: 'CL', name: 'Casual Leave', annualAllocation: 12, allowsHalfDay: true, requiresAttachment: false, carryForwardMax: 0 },
        { code: 'SL', name: 'Sick Leave', annualAllocation: 12, allowsHalfDay: true, requiresAttachment: true, attachmentThresholdDays: 2, carryForwardMax: 15 },
        { code: 'EL', name: 'Earned Leave', annualAllocation: 15, allowsHalfDay: false, requiresAttachment: false, carryForwardMax: 30 },
        { code: 'LOP', name: 'Loss of Pay', annualAllocation: null, allowsHalfDay: true, requiresAttachment: false, carryForwardMax: 0 },
        { code: 'C-Off', name: 'Compensatory Off', annualAllocation: 0, allowsHalfDay: true, requiresAttachment: false, carryForwardMax: 0 }
      ];

      for (const p of defaults) {
        await ESS.Data.put(S.leavePolicies, p);
      }
      return defaults;
    },

    /**
     * Gets or generates leave balance for an employee in current year.
     */
    async getBalances(empCode, year) {
      year = year || new Date().getFullYear();
      const balanceId = `${empCode}_${year}`;
      let record = await ESS.Data.get(S.leaveBalances, balanceId);

      if (!record) {
        // Auto-seed balance based on configured policies
        const policies = await this.initPolicies();
        const balances = {};
        policies.forEach(p => {
          balances[p.code] = {
            allocated: p.annualAllocation != null ? p.annualAllocation : null,
            used: 0,
            pending: 0,
            available: p.annualAllocation != null ? p.annualAllocation : null
          };
        });

        record = {
          id: balanceId,
          EmployeeCode: empCode,
          year: year,
          balances: balances,
          updatedAt: new Date().toISOString()
        };
        await ESS.Data.put(S.leaveBalances, record);
      }

      // Re-calculate used & pending from actual leave applications
      await this.recalculateBalances(empCode, year);
      return (await ESS.Data.get(S.leaveBalances, balanceId)).balances;
    },

    /**
     * Recalculates balance directly from approved and pending leave records.
     */
    async recalculateBalances(empCode, year) {
      year = year || new Date().getFullYear();
      const balanceId = `${empCode}_${year}`;
      let record = await ESS.Data.get(S.leaveBalances, balanceId);
      if (!record) return;

      const allApps = await ESS.Data.byIndex(S.leaveApps, 'EmployeeCode', empCode);
      const yearApps = allApps.filter(a => a.startDate && a.startDate.startsWith(String(year)));

      const usedMap = {};
      const pendingMap = {};

      yearApps.forEach(a => {
        if (a.status === 'Approved') {
          usedMap[a.type] = (usedMap[a.type] || 0) + (a.days || 0);
        } else if (ESS.Flow.isPending(a.status)) {
          pendingMap[a.type] = (pendingMap[a.type] || 0) + (a.days || 0);
        }
      });

      Object.keys(record.balances).forEach(code => {
        const b = record.balances[code];
        b.used = usedMap[code] || 0;
        b.pending = pendingMap[code] || 0;
        if (b.allocated != null) {
          b.available = Math.max(0, b.allocated - b.used - b.pending);
        } else {
          b.available = null; // Uncapped like LOP
        }
      });

      record.updatedAt = new Date().toISOString();
      await ESS.Data.put(S.leaveBalances, record);
    },

    /**
     * Calculates net working days between startDate and endDate
     * excluding configured weekly offs and official holidays.
     */
    async calculateWorkingDays(empCode, startDate, endDate, isHalfDay) {
      if (isHalfDay) return 0.5;
      if (startDate === endDate) return 1;

      const dates = ESS.T.range(startDate, endDate);
      const holidays = await ESS.Holidays.getForEmployee(empCode, parseInt(startDate.slice(0, 4)));
      const holidayDates = new Set(holidays.map(h => h.date));

      const cfg = ESS.Settings.get().attendance;
      const weeklyOffs = cfg.weeklyOffDays || [0];
      const satRule = cfg.saturdayRule || 'none';

      let workingCount = 0;
      for (const d of dates) {
        const dow = ESS.T.dow(d);
        let isOff = weeklyOffs.includes(dow) || holidayDates.has(d);
        if (dow === 6) {
          if (satRule === 'all') isOff = true;
          else if (satRule === 'alt') {
            const nth = ESS.T.nthWeekdayOfMonth(d);
            if (nth === 2 || nth === 4) isOff = true;
          }
        }
        if (!isOff) workingCount++;
      }

      return workingCount > 0 ? workingCount : 1; // At least 1 day if span selected
    },

    /**
     * Validates date range overlaps against all existing active leave apps.
     */
    async checkOverlap(empCode, startDate, endDate, excludeAppId) {
      const allApps = await ESS.Data.byIndex(S.leaveApps, 'EmployeeCode', empCode);
      const activeApps = allApps.filter(a =>
        a.id !== excludeAppId &&
        ['Approved', ...ESS.Flow.PENDING].includes(a.status)
      );

      for (const a of activeApps) {
        // Overlap condition: (StartA <= EndB) and (EndA >= StartB)
        if (startDate <= a.endDate && endDate >= a.startDate) {
          return {
            hasOverlap: true,
            conflictingApp: a,
            message: `Selected dates overlap with an existing ${a.status.toLowerCase()} leave request (${a.id}: ${ESS.T.date(a.startDate)} to ${ESS.T.date(a.endDate)}).`
          };
        }
      }
      return { hasOverlap: false };
    },

    /**
     * Applies for leave and triggers approval workflow.
     */
    async apply({ empCode, type, startDate, endDate, isHalfDay, halfDayPeriod, reason, attachmentFileId }) {
      const actor = ESS.Auth.actor();
      ESS.require(actor, 'Not signed in', 'auth');
      ESS.Auth.requireSelfOrHR(empCode);

      ESS.require(this.TYPES.some(t => t.code === type), 'Invalid leave type.');
      ESS.require(ESS.T.isYmd(startDate), 'Invalid start date.');
      ESS.require(ESS.T.isYmd(endDate), 'Invalid end date.');
      ESS.require(startDate <= endDate, 'End date cannot be earlier than start date.');
      ESS.require((reason || '').trim().length >= 5, 'Please provide a reason for leave (at least 5 characters).');

      if (isHalfDay) {
        ESS.require(startDate === endDate, 'Half day leave can only be applied for a single day.');
        const tObj = this.TYPES.find(t => t.code === type);
        ESS.require(tObj.allowsHalfDay, `${tObj.name} does not allow half-day applications.`);
      }

      // Check overlap
      const overlap = await this.checkOverlap(empCode, startDate, endDate);
      if (overlap.hasOverlap) {
        throw new ESS.Error(overlap.message, 'leave_overlap');
      }

      // Check attachment if required
      const tObj = this.TYPES.find(t => t.code === type);
      const calculatedDays = await this.calculateWorkingDays(empCode, startDate, endDate, isHalfDay);

      if (tObj.requiresAttachment && tObj.attachmentThresholdDays && calculatedDays >= tObj.attachmentThresholdDays) {
        ESS.require(attachmentFileId, `A supporting medical certificate or attachment is required for ${type} of ${tObj.attachmentThresholdDays} or more days.`, 'attachment_required');
      }

      // Check balance
      const balances = await this.getBalances(empCode, parseInt(startDate.slice(0, 4)));
      const typeBal = balances[type];
      if (typeBal && typeBal.available != null && calculatedDays > typeBal.available) {
        throw new ESS.Error(`Insufficient ${type} balance. Requested: ${calculatedDays} days, Available: ${typeBal.available} days. You may apply for LOP instead.`, 'insufficient_balance');
      }

      const reqId = ESS.uid('LEV');
      const now = new Date().toISOString();
      const emp = ESS.Org.get(empCode);
      const mgr = ESS.Org.managerOf(empCode);
      const hrEmail = (ESS.Settings.get().email || {}).hrEmail || '';

      let app = {
        id: reqId,
        EmployeeCode: empCode,
        employeeName: emp ? emp.EmployeeName : empCode,
        designation: emp ? emp.Designation : '',
        division: emp ? emp.Division : '',
        hq: emp ? emp.HQ : '',
        type: type,
        startDate: startDate,
        endDate: endDate,
        days: calculatedDays,
        halfDay: isHalfDay ? (halfDayPeriod || 'First Half') : null,
        reason: reason.trim(),
        attachmentFileId: attachmentFileId || null,
        managerCode: mgr ? mgr.EmployeeCode : null,
        managerName: mgr ? mgr.EmployeeName : null,
        status: 'Draft',
        createdAt: now,
        updatedAt: now
      };

      // Start workflow
      app = ESS.Flow.start('leave', app, 'Leave Application Submitted');

      const ops = [{ op: 'put', store: S.leaveApps, value: app }];

      // Notify approver
      const curStage = ESS.Flow.currentStage(app);
      if (curStage) {
        ESS.Flow.recipientsFor(curStage).forEach(to => {
          ops.push({
            op: 'put',
            store: S.notifications,
            value: {
              id: ESS.uid('NT'),
              RecipientCode: to,
              type: 'info',
              title: `New Leave Request from ${emp ? emp.EmployeeName : empCode}`,
              body: `${type} for ${calculatedDays} day(s) (${ESS.T.date(startDate)}): ${reason}`,
              link: { page: 'approvals', id: reqId },
              createdAt: now,
              readAt: null
            }
          });
        });
      }

      await ESS.Data.batch(ops);
      await this.recalculateBalances(empCode, parseInt(startDate.slice(0, 4)));

      await ESS.Audit.log({
        module: 'Leave',
        action: 'Leave Application Submitted',
        recordId: reqId,
        employeeCode: empCode,
        note: `${type} (${calculatedDays} days) from ${startDate} to ${endDate}`
      });

      // Prepare email draft
      const tpl = ESS.Email.templates.leaveSubmitted(app, emp || { EmployeeName: empCode }, curStage ? ESS.Flow.stageLabel(curStage) : 'Sir/Madam');
      const emailBase = {
        requestId: reqId,
        kind: 'leave',
        employeeCode: empCode,
        purpose: 'Leave application notification',
        to: curStage && curStage.approverCode ? ESS.Email.addressOf(curStage.approverCode) : hrEmail,
        cc: hrEmail,
        subject: tpl.subject,
        body: tpl.body
      };
      // Registers the request with the server -> secure approve/reject link (valid 24h) is embedded in the draft
      const emailDraft = ESS.Remote ? await ESS.Remote.registerDraft('leave', app, emp, emailBase) : await ESS.Email.create(emailBase);

      return { app, emailDraft };
    },

    /**
     * Gets all leave applications for an employee.
     */
    async getEmployeeApplications(empCode) {
      const apps = await ESS.Data.byIndex(S.leaveApps, 'EmployeeCode', empCode);
      apps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return apps;
    },

    /**
     * Gets approved leaves in a date range.
     */
    async getApprovedLeavesForEmployee(empCode, startDate, endDate) {
      const allApps = await ESS.Data.byIndex(S.leaveApps, 'EmployeeCode', empCode);
      return allApps.filter(a =>
        a.status === 'Approved' &&
        a.startDate <= endDate &&
        a.endDate >= startDate
      );
    },

    async getApprovedLeavesOnDate(empCode, date) {
      return this.getApprovedLeavesForEmployee(empCode, date, date);
    }
  };

  // Register hook for approved leaves to refresh balance immediately
  ESS.Hooks.leave = {
    Approved: async (app) => {
      // Balance is refreshed in recalculateBalances
      await ESS.Leave.recalculateBalances(app.EmployeeCode, parseInt(app.startDate.slice(0, 4)));
      return [];
    }
  };
})(window);
