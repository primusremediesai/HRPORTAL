/* ==========================================================================
   PRIMUS REMEDIES — ESS — ATTENDANCE ENGINE
   Real clock in/out • Location dropdown (Uppal, Secunderabad, Current Location) •
   Browser geolocation only on "Current Location" • Attendance state machine •
   Late calculation • Working hours • Missed punch correction requests.
   ========================================================================== */
(function (global) {
  'use strict';
  const ESS = (global.ESS = global.ESS || {});
  const S = ESS.S;

  ESS.Attendance = {
    LOCATIONS: [
      { id: 'Uppal', label: 'Uppal (Primus Office)', requiresGeo: false },
      { id: 'Secunderabad', label: 'Secunderabad (Corporate Office)', requiresGeo: false },
      { id: 'Current Location', label: 'Current Location (On-field / Remote)', requiresGeo: true }
    ],

    /**
     * Obtains user location ONLY if requested for "Current Location".
     */
    async resolveLocation(locationChoice) {
      if (locationChoice !== 'Current Location') {
        return {
          office: locationChoice,
          mode: 'predefined',
          geo: null,
          note: `Selected office: ${locationChoice}`
        };
      }

      if (!navigator.geolocation) {
        throw new ESS.Error('Geolocation is not supported by this browser. Please select an office location.', 'geo_unsupported');
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new ESS.Error('Location request timed out. Please check GPS reception and try again.', 'geo_timeout'));
        }, 10000);

        navigator.geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timeout);
            resolve({
              office: 'Current Location',
              mode: 'geolocation',
              geo: {
                lat: Number(pos.coords.latitude.toFixed(6)),
                lng: Number(pos.coords.longitude.toFixed(6)),
                accuracyMeters: Math.round(pos.coords.accuracy)
              },
              note: `Field GPS: Lat ${pos.coords.latitude.toFixed(4)}, Lng ${pos.coords.longitude.toFixed(4)} (±${Math.round(pos.coords.accuracy)}m)`
            });
          },
          (err) => {
            clearTimeout(timeout);
            let msg = 'Location permission was denied. To punch in from Current Location, please allow location access in your browser settings.';
            if (err.code === err.POSITION_UNAVAILABLE) msg = 'Location signal unavailable. Please ensure GPS is enabled or select an office.';
            reject(new ESS.Error(msg, 'geo_denied'));
          },
          { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 }
        );
      });
    },

    /**
     * Gets today's attendance session for current employee.
     */
    async getTodaySession(empCode) {
      const today = ESS.T.today();
      const sessions = await ESS.Data.byIndex(S.sessions, 'EmpDate', [empCode, today]);
      return sessions && sessions.length ? sessions[0] : null;
    },

    /**
     * Clock-In workflow.
     */
    async clockIn({ empCode, location, faceResult }) {
      const actor = ESS.Auth.actor();
      ESS.require(actor, 'You must be signed in to clock in.', 'auth');
      ESS.Auth.requireSelfOrHR(empCode);

      // Validate location choice
      const validLocs = this.LOCATIONS.map(l => l.id);
      ESS.require(validLocs.includes(location), `Invalid work location. Must be one of: ${validLocs.join(', ')}`);

      // Resolve location details
      const locData = await this.resolveLocation(location);

      // Check face verification requirements
      const cfg = ESS.Settings.get().attendance;
      if (cfg.requireFace) {
        ESS.require(faceResult && faceResult.verified === true, 'Facial identity verification is required to clock in.', 'face_required');
      }

      const today = ESS.T.today();
      const now = new Date().toISOString();

      // Check existing session
      const existing = await this.getTodaySession(empCode);
      if (existing) {
        if (existing.clockIn && !existing.clockOut) {
          throw new ESS.Error('You are already clocked in for today. Clock out when your shift ends.', 'already_clocked_in');
        }
        if (existing.clockIn && existing.clockOut) {
          throw new ESS.Error('Today\'s attendance session is already completed. Multiple clock-in sessions are restricted. Submit an attendance correction request if needed.', 'session_completed');
        }
      }

      // Check if employee is on approved leave today
      const approvedLeaves = await ESS.Leave.getApprovedLeavesOnDate(empCode, today);
      if (approvedLeaves.length > 0) {
        // Warning or handle
      }

      // Calculate shift & late status
      const shiftStartTime = cfg.shiftStart || '09:30';
      const nowHM = ESS.T.hm(now);
      const graceMin = cfg.graceMinutes || 15;
      
      const shiftStartMin = parseInt(shiftStartTime.split(':')[0]) * 60 + parseInt(shiftStartTime.split(':')[1]);
      const nowMin = parseInt(nowHM.split(':')[0]) * 60 + parseInt(nowHM.split(':')[1]);
      const isLate = nowMin > (shiftStartMin + graceMin);
      const lateMinutes = isLate ? (nowMin - shiftStartMin) : 0;

      const sessionId = existing ? existing.id : ESS.uid('ATT');
      const session = {
        id: sessionId,
        EmployeeCode: empCode,
        Date: today,
        EmpDate: [empCode, today],
        clockIn: now,
        clockOut: null,
        durationMinutes: 0,
        status: isLate ? 'Late Arrival' : 'Present',
        shiftStatus: isLate ? `Late by ${lateMinutes} mins` : 'On Time',
        locationIn: location,
        locationDataIn: locData,
        locationOut: null,
        locationDataOut: null,
        verificationIn: {
          verified: faceResult ? faceResult.verified : false,
          mode: faceResult ? faceResult.mode : 'not_required',
          serviceName: faceResult ? faceResult.serviceName : null,
          confidence: faceResult ? faceResult.confidence : null,
          timestamp: faceResult ? faceResult.timestamp : now
        },
        verificationOut: null,
        correctionStatus: null,
        correctionId: null,
        createdAt: now,
        updatedAt: now
      };

      const event = {
        id: ESS.uid('AE'),
        SessionId: sessionId,
        EmployeeCode: empCode,
        type: 'CLOCK_IN',
        timestamp: now,
        location: location,
        locationData: locData,
        verification: session.verificationIn
      };

      await ESS.Data.batch([
        { op: 'put', store: S.sessions, value: session },
        { op: 'put', store: S.events, value: event }
      ]);

      await ESS.Audit.log({
        module: 'Attendance',
        action: 'Clock In',
        recordId: sessionId,
        employeeCode: empCode,
        note: `Clocked in at ${ESS.T.time(now)} from ${location} (${session.status})`
      });

      return session;
    },

    /**
     * Clock-Out workflow.
     */
    async clockOut({ empCode, location, faceResult }) {
      const actor = ESS.Auth.actor();
      ESS.require(actor, 'You must be signed in to clock out.', 'auth');
      ESS.Auth.requireSelfOrHR(empCode);

      const session = await this.getTodaySession(empCode);
      if (!session || !session.clockIn) {
        throw new ESS.Error('No active clock-in found for today. You must clock in before clocking out.', 'no_clock_in');
      }
      if (session.clockOut) {
        throw new ESS.Error('You have already clocked out for today.', 'already_clocked_out');
      }

      // Validate location
      const validLocs = this.LOCATIONS.map(l => l.id);
      ESS.require(validLocs.includes(location), `Invalid work location. Must be one of: ${validLocs.join(', ')}`);
      const locData = await this.resolveLocation(location);

      const cfg = ESS.Settings.get().attendance;
      if (cfg.requireFaceOnClockOut) {
        ESS.require(faceResult && faceResult.verified === true, 'Facial verification is required to clock out.', 'face_required');
      }

      const now = new Date().toISOString();
      const inTime = new Date(session.clockIn);
      const outTime = new Date(now);
      const durationMin = Math.max(0, Math.round((outTime - inTime) / 60000));

      // Working hours evaluation
      const fullDayMin = cfg.fullDayMinutes || 480;
      const halfDayMin = cfg.halfDayMinutes || 240;

      let finalStatus = session.status;
      if (durationMin < halfDayMin) {
        finalStatus = 'Incomplete';
      } else if (durationMin < fullDayMin) {
        finalStatus = 'Half Day';
      } else if (session.status === 'Late Arrival') {
        finalStatus = 'Late Arrival';
      } else {
        finalStatus = 'Present';
      }

      session.clockOut = now;
      session.durationMinutes = durationMin;
      session.status = finalStatus;
      session.locationOut = location;
      session.locationDataOut = locData;
      session.verificationOut = {
        verified: faceResult ? faceResult.verified : false,
        mode: faceResult ? faceResult.mode : 'not_required',
        serviceName: faceResult ? faceResult.serviceName : null,
        confidence: faceResult ? faceResult.confidence : null,
        timestamp: faceResult ? faceResult.timestamp : now
      };
      session.updatedAt = now;

      const event = {
        id: ESS.uid('AE'),
        SessionId: session.id,
        EmployeeCode: empCode,
        type: 'CLOCK_OUT',
        timestamp: now,
        location: location,
        locationData: locData,
        verification: session.verificationOut
      };

      await ESS.Data.batch([
        { op: 'put', store: S.sessions, value: session },
        { op: 'put', store: S.events, value: event }
      ]);

      await ESS.Audit.log({
        module: 'Attendance',
        action: 'Clock Out',
        recordId: session.id,
        employeeCode: empCode,
        note: `Clocked out at ${ESS.T.time(now)}. Total duration: ${ESS.T.dur(durationMin)} (${finalStatus})`
      });

      return session;
    },

    /**
     * Submit an Attendance Correction Request.
     */
    async submitCorrection({ empCode, date, proposedIn, proposedOut, reason }) {
      const actor = ESS.Auth.actor();
      ESS.require(actor, 'Not signed in', 'auth');
      ESS.Auth.requireSelfOrHR(empCode);

      ESS.require(ESS.T.isYmd(date), 'Invalid date format.');
      ESS.require(date <= ESS.T.today(), 'Cannot request attendance correction for future dates.');
      ESS.require((reason || '').trim().length >= 10, 'Please provide a detailed reason (at least 10 characters).');

      const cfg = ESS.Settings.get().attendance;
      const windowDays = cfg.correctionWindowDays || 30;
      const diff = ESS.T.diffDays(date, ESS.T.today());
      if (diff > windowDays) {
        throw new ESS.Error(`Attendance corrections must be submitted within ${windowDays} days of the punch date.`, 'correction_window_expired');
      }

      // Check existing pending correction for this date
      const allCorrections = await ESS.Data.byIndex(S.corrections, 'EmployeeCode', empCode);
      const pendingExisting = allCorrections.find(c => c.date === date && ESS.Flow.isPending(c.status));
      if (pendingExisting) {
        throw new ESS.Error('A pending correction request already exists for this date.', 'duplicate_correction');
      }

      const existingSession = (await ESS.Data.byIndex(S.sessions, 'EmpDate', [empCode, date]))[0] || null;

      const correctionId = ESS.uid('COR');
      const now = new Date().toISOString();

      let correction = {
        id: correctionId,
        EmployeeCode: empCode,
        date: date,
        existingIn: existingSession ? existingSession.clockIn : null,
        existingOut: existingSession ? existingSession.clockOut : null,
        proposedIn: proposedIn || null,
        proposedOut: proposedOut || null,
        reason: reason.trim(),
        status: 'Draft',
        createdAt: now,
        updatedAt: now
      };

      // Route through workflow
      correction = ESS.Flow.start('correction', correction, 'Submitted Missed Punch Correction');

      const ops = [{ op: 'put', store: S.corrections, value: correction }];

      // Notify approver
      const curStage = ESS.Flow.currentStage(correction);
      const emp = ESS.Org.get(empCode);
      if (curStage) {
        ESS.Flow.recipientsFor(curStage).forEach(to => {
          ops.push({
            op: 'put',
            store: S.notifications,
            value: {
              id: ESS.uid('NT'),
              RecipientCode: to,
              type: 'info',
              title: `Attendance correction for ${emp ? emp.EmployeeName : empCode}`,
              body: `Punch correction requested for ${ESS.T.date(date)}: ${reason}`,
              link: { page: 'approvals', id: correctionId },
              createdAt: now,
              readAt: null
            }
          });
        });
      }

      await ESS.Data.batch(ops);

      await ESS.Audit.log({
        module: 'Attendance',
        action: 'Attendance Correction Submitted',
        recordId: correctionId,
        employeeCode: empCode,
        note: `Correction for ${date}: ${reason}`
      });

      // Prepare email draft
      const empTpl = ESS.Email.templates.correctionSubmitted(correction, emp || { EmployeeName: empCode });
      const emailBase = {
        requestId: correctionId,
        kind: 'correction',
        employeeCode: empCode,
        purpose: 'Attendance correction notification',
        to: curStage && curStage.approverCode ? ESS.Email.addressOf(curStage.approverCode) : '',
        subject: empTpl.subject,
        body: empTpl.body
      };
      const emailDraft = ESS.Remote ? await ESS.Remote.registerDraft('correction', correction, emp, emailBase) : await ESS.Email.create(emailBase);

      return { correction, emailDraft };
    },

    /**
     * Gets attendance history for an employee in a given month (YYYY-MM).
     */
    async getMonthlyHistory(empCode, monthKey) {
      const allSessions = await ESS.Data.byIndex(S.sessions, 'EmployeeCode', empCode);
      const filtered = allSessions.filter(s => s.Date && s.Date.startsWith(monthKey));
      filtered.sort((a, b) => b.Date.localeCompare(a.Date));
      return filtered;
    },

    /**
     * Synthesizes day-by-day calendar data combining sessions, leaves, holidays, and weekly offs.
     */
    async getCalendarMonthData(empCode, year, month) {
      const monthStr = ESS.T.pad(month);
      const monthKey = `${year}-${monthStr}`;
      const daysInMonth = new Date(year, month, 0).getDate();
      const startDate = `${monthKey}-01`;
      const endDate = `${monthKey}-${ESS.T.pad(daysInMonth)}`;

      const sessions = await this.getMonthlyHistory(empCode, monthKey);
      const sessionMap = new Map(sessions.map(s => [s.Date, s]));

      const leaves = await ESS.Leave.getApprovedLeavesForEmployee(empCode, startDate, endDate);
      const leaveMap = new Map();
      leaves.forEach(l => {
        const range = ESS.T.range(l.startDate, l.endDate);
        range.forEach(d => {
          if (d.startsWith(monthKey)) leaveMap.set(d, l);
        });
      });

      const holidays = await ESS.Holidays.getForEmployee(empCode, year);
      const holidayMap = new Map(holidays.map(h => [h.date, h]));

      const cfg = ESS.Settings.get().attendance;
      const weeklyOffs = cfg.weeklyOffDays || [0]; // Sunday default
      const satRule = cfg.saturdayRule || 'none';

      const days = [];
      const today = ESS.T.today();

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${monthKey}-${ESS.T.pad(day)}`;
        const dow = ESS.T.dow(dateStr);
        const isFuture = dateStr > today;

        let type = 'Working Day';
        let badge = 'text-muted';
        let detail = '';
        let session = sessionMap.get(dateStr) || null;
        let leave = leaveMap.get(dateStr) || null;
        let holiday = holidayMap.get(dateStr) || null;

        // Determine day classification
        let isWeeklyOff = weeklyOffs.includes(dow);
        if (dow === 6) { // Saturday
          if (satRule === 'all') isWeeklyOff = true;
          else if (satRule === 'alt') {
            const nthSat = ESS.T.nthWeekdayOfMonth(dateStr);
            if (nthSat === 2 || nthSat === 4) isWeeklyOff = true;
          }
        }

        if (holiday) {
          type = 'Holiday';
          badge = 'badge-holiday';
          detail = holiday.name;
        } else if (leave) {
          type = 'Leave';
          badge = 'badge-leave';
          detail = `${leave.type} (${leave.halfDay ? 'Half Day' : 'Full Day'})`;
        } else if (isWeeklyOff) {
          type = 'Weekly Off';
          badge = 'badge-off';
          detail = dow === 0 ? 'Sunday Off' : 'Saturday Off';
        } else if (session) {
          if (session.status === 'Present') {
            type = 'Present';
            badge = 'badge-present';
            detail = `${ESS.T.time(session.clockIn)} - ${session.clockOut ? ESS.T.time(session.clockOut) : 'In Progress'}`;
          } else if (session.status === 'Late Arrival') {
            type = 'Late Arrival';
            badge = 'badge-late';
            detail = `${session.shiftStatus} (${ESS.T.time(session.clockIn)})`;
          } else if (session.status === 'Incomplete') {
            type = 'Incomplete';
            badge = 'badge-incomplete';
            detail = `Under-hours (${ESS.T.dur(session.durationMinutes)})`;
          } else if (session.status === 'Half Day') {
            type = 'Half Day';
            badge = 'badge-half';
            detail = `Half Day (${ESS.T.dur(session.durationMinutes)})`;
          }
        } else if (!isFuture) {
          type = 'Absent';
          badge = 'badge-absent';
          detail = 'No punch recorded';
        } else {
          type = 'Upcoming';
          badge = 'badge-future';
          detail = 'Scheduled';
        }

        days.push({
          date: dateStr,
          day: day,
          dow: dow,
          weekday: ESS.T.weekday(dateStr),
          type: type,
          badge: badge,
          detail: detail,
          session: session,
          isToday: dateStr === today,
          isFuture: isFuture
        });
      }

      return {
        monthKey,
        days,
        stats: {
          present: days.filter(d => ['Present', 'Late Arrival'].includes(d.type)).length,
          absent: days.filter(d => d.type === 'Absent').length,
          leave: days.filter(d => d.type === 'Leave').length,
          holiday: days.filter(d => d.type === 'Holiday').length,
          weeklyOff: days.filter(d => d.type === 'Weekly Off').length,
          incomplete: days.filter(d => d.type === 'Incomplete').length
        }
      };
    }
  };

  // Register hook for approved attendance corrections
  ESS.Hooks.correction = {
    Approved: async (correction) => {
      // Find or create session for that date and update timestamps
      const sessions = await ESS.Data.byIndex(S.sessions, 'EmpDate', [correction.EmployeeCode, correction.date]);
      let session = sessions[0] || {
        id: ESS.uid('ATT'),
        EmployeeCode: correction.EmployeeCode,
        Date: correction.date,
        EmpDate: [correction.EmployeeCode, correction.date],
        locationIn: 'Corrected Punch',
        createdAt: new Date().toISOString()
      };

      if (correction.proposedIn) session.clockIn = correction.proposedIn;
      if (correction.proposedOut) session.clockOut = correction.proposedOut;

      if (session.clockIn && session.clockOut) {
        session.durationMinutes = Math.max(0, Math.round((new Date(session.clockOut) - new Date(session.clockIn)) / 60000));
        session.status = 'Present (Corrected)';
      }
      session.correctionStatus = 'Approved';
      session.correctionId = correction.id;
      session.updatedAt = new Date().toISOString();

      return [{ op: 'put', store: S.sessions, value: session }];
    }
  };
})(window);
