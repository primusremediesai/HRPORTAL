/* ==========================================================================
   PRIMUS REMEDIES — ESS — HOLIDAYS & INTEGRATED CALENDAR
   Company official holidays • Regional / office applicability •
   Month / Week / Agenda views • Unified events (Holidays, Leaves, Punches).
   ========================================================================== */
(function (global) {
  'use strict';
  const ESS = (global.ESS = global.ESS || {});
  const S = ESS.S;

  ESS.Holidays = {
    /**
     * Official Primus Corporate / Regional holiday list defaults.
     */
    DEFAULT_HOLIDAYS_2026: [
      { id: 'HOL-2026-001', name: 'New Year\'s Day', date: '2026-01-01', category: 'National / General', office: 'All', description: 'Beginning of the calendar year' },
      { id: 'HOL-2026-002', name: 'Sankranti / Pongal', date: '2026-01-14', category: 'Festival', office: 'All', description: 'Harvest festival' },
      { id: 'HOL-2026-003', name: 'Republic Day', date: '2026-01-26', category: 'National', office: 'All', description: 'Indian Republic Day' },
      { id: 'HOL-2026-004', name: 'Maha Shivratri', date: '2026-02-16', category: 'Festival', office: 'All', description: 'Religious festival' },
      { id: 'HOL-2026-005', name: 'Holi', date: '2026-03-04', category: 'Festival', office: 'All', description: 'Festival of colours' },
      { id: 'HOL-2026-006', name: 'Ugadi / Telugu New Year', date: '2026-03-20', category: 'Regional', office: 'Telangana & Andhra', description: 'Telugu New Year' },
      { id: 'HOL-2026-007', name: 'Eid-ul-Fitr (Ramzan)', date: '2026-03-21', category: 'Festival', office: 'All', description: 'Islamic festival' },
      { id: 'HOL-2026-008', name: 'Good Friday', date: '2026-04-03', category: 'Religious', office: 'All', description: 'Christian remembrance' },
      { id: 'HOL-2026-009', name: 'Dr. B.R. Ambedkar Jayanti', date: '2026-04-14', category: 'National', office: 'All', description: 'Commemoration of Dr. Ambedkar' },
      { id: 'HOL-2026-010', name: 'May Day (Labour Day)', date: '2026-05-01', category: 'General', office: 'All', description: 'International Workers Day' },
      { id: 'HOL-2026-011', name: 'Telangana Formation Day', date: '2026-06-02', category: 'State', office: 'Telangana', description: 'Telangana state formation' },
      { id: 'HOL-2026-012', name: 'Bakrid / Eid-ul-Adha', date: '2026-05-27', category: 'Festival', office: 'All', description: 'Festival of sacrifice' },
      { id: 'HOL-2026-013', name: 'Independence Day', date: '2026-08-15', category: 'National', office: 'All', description: 'Indian Independence Day' },
      { id: 'HOL-2026-014', name: 'Ganesh Chaturthi', date: '2026-09-14', category: 'Festival', office: 'All', description: 'Vinayaka Chavithi' },
      { id: 'HOL-2026-015', name: 'Mahatma Gandhi Jayanti', date: '2026-10-02', category: 'National', office: 'All', description: 'Commemoration of Mahatma Gandhi' },
      { id: 'HOL-2026-016', name: 'Vijaya Dashami (Dussehra)', date: '2026-10-20', category: 'Festival', office: 'All', description: 'Dussehra festival' },
      { id: 'HOL-2026-017', name: 'Deepavali (Diwali)', date: '2026-11-08', category: 'Festival', office: 'All', description: 'Festival of lights' },
      { id: 'HOL-2026-018', name: 'Christmas', date: '2026-12-25', category: 'Festival', office: 'All', description: 'Christmas celebration' }
    ],

    /**
     * Initializes default holidays if not present.
     */
    async init() {
      const existing = await ESS.Data.getAll(S.holidays);
      if (existing && existing.length > 0) return existing;

      for (const h of this.DEFAULT_HOLIDAYS_2026) {
        h.weekday = ESS.T.weekday(h.date);
        await ESS.Data.put(S.holidays, h);
      }
      return this.DEFAULT_HOLIDAYS_2026;
    },

    /**
     * Gets all holidays, optionally filtered by year and office/HQ.
     */
    async getAll(year) {
      await this.init();
      let holidays = await ESS.Data.getAll(S.holidays);
      if (year) {
        holidays = holidays.filter(h => h.date && h.date.startsWith(String(year)));
      }
      holidays.sort((a, b) => a.date.localeCompare(b.date));
      return holidays;
    },

    /**
     * Gets applicable holidays for a specific employee.
     */
    async getForEmployee(empCode, year) {
      const all = await this.getAll(year);
      const emp = ESS.Org.get(empCode);
      const hq = emp ? (emp.HQ || '').toLowerCase() : '';

      return all.filter(h => {
        if (!h.office || h.office === 'All') return true;
        const off = h.office.toLowerCase();
        if (off.includes('telangana') && (hq.includes('uppal') || hq.includes('secunderabad') || hq.includes('hyderabad'))) return true;
        if (off.includes(hq) || hq.includes(off)) return true;
        return false;
      });
    },

    /**
     * Admin: add or update a holiday.
     */
    async save(h) {
      ESS.Auth.require('admin.holiday');
      ESS.require(h.name && h.name.trim(), 'Holiday name is required.');
      ESS.require(ESS.T.isYmd(h.date), 'Valid date is required.');

      const rec = Object.assign({}, h, {
        id: h.id || ESS.uid('HOL'),
        name: h.name.trim(),
        date: h.date,
        weekday: ESS.T.weekday(h.date),
        category: h.category || 'General',
        office: h.office || 'All',
        description: h.description || '',
        updatedAt: new Date().toISOString()
      });

      await ESS.Data.put(S.holidays, rec);
      await ESS.Audit.log({
        module: 'Holiday Configuration',
        action: 'Holiday Saved',
        recordId: rec.id,
        note: `${rec.name} on ${rec.date} (${rec.office})`
      });
      return rec;
    },

    /**
     * Admin: delete a holiday.
     */
    async delete(id) {
      ESS.Auth.require('admin.holiday');
      const ex = await ESS.Data.get(S.holidays, id);
      if (ex) {
        await ESS.Data.del(S.holidays, id);
        await ESS.Audit.log({
          module: 'Holiday Configuration',
          action: 'Holiday Deleted',
          recordId: id,
          note: `${ex.name} on ${ex.date}`
        });
      }
    }
  };

  /**
   * Calendar view model engine (Month, Week, Agenda).
   */
  ESS.Calendar = {
    async getEventsForRange(empCode, startDate, endDate) {
      const events = [];

      // 1. Company Holidays
      const year = parseInt(startDate.slice(0, 4));
      const holidays = await ESS.Holidays.getForEmployee(empCode, year);
      holidays.forEach(h => {
        if (h.date >= startDate && h.date <= endDate) {
          events.push({
            id: h.id,
            type: 'holiday',
            title: h.name,
            date: h.date,
            endDate: h.date,
            category: h.category,
            badgeClass: 'badge-holiday',
            icon: '🎉',
            details: `${h.category} · ${h.office} · ${h.description || ''}`
          });
        }
      });

      // 2. Approved & Pending Leaves
      const allLeaves = await ESS.Data.byIndex(S.leaveApps, 'EmployeeCode', empCode);
      allLeaves.forEach(l => {
        if (['Approved', ...ESS.Flow.PENDING].includes(l.status)) {
          if (l.startDate <= endDate && l.endDate >= startDate) {
            events.push({
              id: l.id,
              type: 'leave',
              title: `${l.type} (${l.status})`,
              date: l.startDate,
              endDate: l.endDate,
              days: l.days,
              badgeClass: l.status === 'Approved' ? 'badge-leave' : 'badge-leave-pending',
              icon: '🏖️',
              details: `${l.days} day(s) · ${l.halfDay ? l.halfDay : 'Full Day'} · ${l.reason}`
            });
          }
        }
      });

      // 3. Attendance Sessions
      const allSessions = await ESS.Data.byIndex(S.sessions, 'EmployeeCode', empCode);
      allSessions.forEach(s => {
        if (s.Date >= startDate && s.Date <= endDate) {
          events.push({
            id: s.id,
            type: 'attendance',
            title: `Punch: ${s.status}`,
            date: s.Date,
            endDate: s.Date,
            badgeClass: s.status === 'Present' ? 'badge-present' : (s.status === 'Late Arrival' ? 'badge-late' : 'badge-incomplete'),
            icon: '⏱️',
            details: `In: ${ESS.T.time(s.clockIn)} | Out: ${s.clockOut ? ESS.T.time(s.clockOut) : '—'} (${ESS.T.dur(s.durationMinutes)})`
          });
        }
      });

      events.sort((a, b) => a.date.localeCompare(b.date));
      return events;
    }
  };
})(window);
