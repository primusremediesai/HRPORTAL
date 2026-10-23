/* ==========================================================================
   PRIMUS REMEDIES — EMPLOYEE SELF-SERVICE (ESS) — CORE
   Schema migration • data-access layer • settings • org hierarchy •
   auth / RBAC • tamper-evident audit • notifications • email drafts •
   approval workflow engine.

   NOTE: This build runs entirely in the browser (IndexedDB) for local
   development. Authorisation checks here are a client-side guard, NOT a
   security boundary. Production needs a server (see docs/ESS_INTEGRATION.md).
   ========================================================================== */
(function (global) {
  'use strict';
  const ESS = (global.ESS = global.ESS || {});
  ESS.VERSION = '1.0.0';

  /* ------------------------------------------------------------------ */
  /* Store names                                                         */
  /* ------------------------------------------------------------------ */
  const S = (ESS.S = {
    sessions: 'ess_att_sessions', events: 'ess_att_events', corrections: 'ess_att_corrections',
    leavePolicies: 'ess_leave_policies', leaveBalances: 'ess_leave_balances', leaveApps: 'ess_leave_apps',
    approvals: 'ess_approvals', holidays: 'ess_holidays', claims: 'ess_expense_claims',
    files: 'ess_files', documents: 'ess_documents', notifications: 'ess_notifications',
    settings: 'ess_settings', audit: 'ess_audit', empCfg: 'ess_employee_cfg',
    emails: 'ess_emails', meta: 'ess_meta'
  });

  class ESSError extends Error {
    constructor(message, code) { super(message); this.name = 'ESSError'; this.code = code || 'error'; }
  }
  ESS.Error = ESSError;

  /* ------------------------------------------------------------------ */
  /* Versioned, additive schema migration (never deletes existing data)  */
  /* ------------------------------------------------------------------ */
  ESS.Schema = {
    version: 6,
    migrations: [{
      version: 4,
      name: 'ESS initial schema (attendance, leave, expense, documents, notifications, audit)',
      up(db) {
        const mk = (name, opts, indexes) => {
          if (db.objectStoreNames.contains(name)) return;
          const st = db.createObjectStore(name, opts);
          (indexes || []).forEach(([n, kp, o]) => st.createIndex(n, kp, o || { unique: false }));
        };
        mk(S.sessions, { keyPath: 'id' }, [['EmployeeCode', 'EmployeeCode'], ['Date', 'Date'], ['EmpDate', ['EmployeeCode', 'Date'], { unique: true }]]);
        mk(S.events, { keyPath: 'id' }, [['EmployeeCode', 'EmployeeCode'], ['SessionId', 'SessionId']]);
        mk(S.corrections, { keyPath: 'id' }, [['EmployeeCode', 'EmployeeCode'], ['Status', 'status']]);
        mk(S.leavePolicies, { keyPath: 'code' });
        mk(S.leaveBalances, { keyPath: 'id' }, [['EmployeeCode', 'EmployeeCode']]);
        mk(S.leaveApps, { keyPath: 'id' }, [['EmployeeCode', 'EmployeeCode'], ['Status', 'status']]);
        mk(S.approvals, { keyPath: 'id' }, [['RequestId', 'RequestId'], ['EmployeeCode', 'EmployeeCode'], ['ActorCode', 'ActorCode']]);
        mk(S.holidays, { keyPath: 'id' }, [['Date', 'date']]);
        mk(S.claims, { keyPath: 'id' }, [['EmployeeCode', 'EmployeeCode'], ['Status', 'status']]);
        mk(S.files, { keyPath: 'id' }, [['OwnerCode', 'ownerCode']]);
        mk(S.documents, { keyPath: 'id' }, [['EmployeeCode', 'EmployeeCode'], ['Category', 'category'], ['Status', 'status']]);
        mk(S.notifications, { keyPath: 'id' }, [['RecipientCode', 'RecipientCode']]);
        mk(S.settings, { keyPath: 'key' });
        mk(S.audit, { keyPath: 'id', autoIncrement: true }, [['EmployeeCode', 'EmployeeCode'], ['Action', 'Action'], ['Timestamp', 'Timestamp']]);
        mk(S.empCfg, { keyPath: 'EmployeeCode' });
        mk(S.emails, { keyPath: 'id' }, [['RequestId', 'requestId']]);
        mk(S.meta, { keyPath: 'key' });
      }
    }, {
      version: 6,
      name: 'ESS schema alignment and store verification',
      up(db) {
        if (ESS.Schema.migrations[0]) {
          ESS.Schema.migrations[0].up(db);
        }
      }
    }],
    /** Called from HRDatabase.init() onupgradeneeded. */
    upgrade(db, oldVersion, tx) {
      this.migrations.forEach(m => m.up(db, tx));
    },
    missingStores() {
      const d = global.db || (typeof window !== 'undefined' ? window.db : null) || (typeof db !== 'undefined' ? db : null);
      return d && d.db ? Object.values(S).filter(n => !d.db.objectStoreNames.contains(n)) : [];
    },
    async recordApplied() {
      const rec = (await ESS.Data.get(S.meta, 'migrations')) || { key: 'migrations', applied: [] };
      const have = new Set(rec.applied.map(a => a.version));
      let changed = false;
      this.migrations.forEach(m => {
        if (!have.has(m.version)) { rec.applied.push({ version: m.version, name: m.name, at: new Date().toISOString() }); changed = true; }
      });
      if (changed) await ESS.Data.put(S.meta, rec, true);
      return rec;
    }
  };

  /* ------------------------------------------------------------------ */
  /* Data-access layer. Adapters can be swapped for a shared backend.    */
  /* ------------------------------------------------------------------ */
  class LocalAdapter {
    constructor() { this.name = 'local-indexeddb'; }
    get _db() { return global.db || (typeof window !== 'undefined' ? window.db : null) || (typeof db !== 'undefined' ? db : null); }
    get(s, k) { return this._db.get(s, k); }
    getAll(s) { return this._db.getAll(s); }
    put(s, v) { return this._db.put(s, v); }
    add(s, v) { return this._db.add(s, v); }
    del(s, k) { return this._db.delete(s, k); }
    byIndex(s, i, v) { return this._db.getByIndex(s, i, v); }
    batch(ops) {
      return new Promise((resolve, reject) => {
        const stores = [...new Set(ops.map(o => o.store))];
        const tx = this._db.db.transaction(stores, 'readwrite');
        ops.forEach(o => {
          const st = tx.objectStore(o.store);
          if (o.op === 'put') st.put(o.value);
          else if (o.op === 'add') st.add(o.value);
          else if (o.op === 'delete') st.delete(o.key);
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
      });
    }
  }

  /**
   * RemoteAdapter — REST contract for a shared backend (UNTESTED skeleton).
   * GET/PUT/DELETE {base}/{store}/{key}, GET {base}/{store}, GET {base}/{store}?index=&value=,
   * POST {base}/batch. See docs/ESS_INTEGRATION.md. Not enabled by default.
   */
  class RemoteAdapter {
    constructor(base, headers) { this.name = 'remote-http'; this.base = base.replace(/\/$/, ''); this.headers = headers || {}; }
    async _f(path, opt) {
      const r = await fetch(this.base + path, Object.assign({ credentials: 'include', headers: Object.assign({ 'Content-Type': 'application/json' }, this.headers) }, opt));
      if (!r.ok) throw new ESSError('Backend error ' + r.status, 'backend');
      return r.status === 204 ? null : r.json();
    }
    get(s, k) { return this._f(`/${s}/${encodeURIComponent(k)}`); }
    getAll(s) { return this._f(`/${s}`); }
    put(s, v) { return this._f(`/${s}`, { method: 'PUT', body: JSON.stringify(v) }); }
    add(s, v) { return this._f(`/${s}`, { method: 'POST', body: JSON.stringify(v) }); }
    del(s, k) { return this._f(`/${s}/${encodeURIComponent(k)}`, { method: 'DELETE' }); }
    byIndex(s, i, v) { return this._f(`/${s}?index=${encodeURIComponent(i)}&value=${encodeURIComponent(JSON.stringify(v))}`); }
    batch(ops) { return this._f('/batch', { method: 'POST', body: JSON.stringify(ops) }); }
  }
  ESS.LocalAdapter = LocalAdapter;
  ESS.RemoteAdapter = RemoteAdapter;

  ESS.Data = {
    adapter: new LocalAdapter(),
    use(adapter) { this.adapter = adapter; },
    _guard(store, internal) {
      if (store === S.audit && !internal) throw new ESSError('The audit trail is append-only and cannot be modified.', 'forbidden');
    },
    get(s, k) { return this.adapter.get(s, k); },
    getAll(s) { return this.adapter.getAll(s); },
    byIndex(s, i, v) { return this.adapter.byIndex(s, i, v); },
    put(s, v, internal) { this._guard(s, internal); return this.adapter.put(s, v); },
    add(s, v, internal) { this._guard(s, internal); return this.adapter.add(s, v); },
    del(s, k) { this._guard(s); return this.adapter.del(s, k); },
    batch(ops) { ops.forEach(o => this._guard(o.store, o.internal)); return this.adapter.batch(ops); }
  };

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  ESS.esc = esc;
  ESS.clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  ESS.uid = (prefix) => {
    const abc = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
    const r = new Uint8Array(5); (global.crypto || {}).getRandomValues ? crypto.getRandomValues(r) : r.forEach((_, i) => (r[i] = Math.random() * 255));
    const d = new Date();
    return `${prefix}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${[...r].map(x => abc[x % abc.length]).join('')}`;
  };
  ESS.inr = (n) => (n == null || isNaN(n) ? '—' : '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  ESS.require = (cond, msg, code) => { if (!cond) throw new ESSError(msg, code || 'invalid'); };
  const deepMerge = (base, over) => {
    if (over === undefined || over === null) return base;
    if (Array.isArray(over) || typeof over !== 'object') return over;
    const out = Object.assign({}, base);
    Object.keys(over).forEach(k => { out[k] = (base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null) ? deepMerge(base[k], over[k]) : over[k]; });
    return out;
  };

  /* ---- Date / time helpers (dates are local calendar 'YYYY-MM-DD') ---- */
  const pad = (n) => String(n).padStart(2, '0');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const T = (ESS.T = {
    MON, MONL, DAYL, pad,
    ymd(d) { d = d || new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },
    today() { return T.ymd(new Date()); },
    isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && T.ymd(T.parse(s)) === s; },
    parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
    addDays(s, n) { const d = T.parse(s); d.setDate(d.getDate() + n); return T.ymd(d); },
    diffDays(a, b) { return Math.round((T.parse(b) - T.parse(a)) / 864e5); },
    range(a, b) { const out = []; for (let d = a, i = 0; d <= b && i < 800; d = T.addDays(d, 1), i++) out.push(d); return out; },
    weekday(s) { return DAYL[T.parse(s).getDay()]; },
    dow(s) { return T.parse(s).getDay(); },
    monthKey(s) { return s.slice(0, 7); },
    monthLabel(mk) { const [y, m] = mk.split('-').map(Number); return `${MONL[m - 1]} ${y}`; },
    date(x) { if (!x) return '—'; const d = /^\d{4}-\d{2}-\d{2}$/.test(x) ? T.parse(x) : new Date(x); if (isNaN(d)) return '—'; return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; },
    time(iso) { if (!iso) return '—'; const d = new Date(iso); if (isNaN(d)) return '—'; return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }); },
    dateTime(iso) { return iso ? `${T.date(iso)}, ${T.time(iso)}` : '—'; },
    minutes(a, b) { return Math.round((new Date(b) - new Date(a)) / 60000); },
    dur(min) { if (min == null || isNaN(min) || min < 0) return '—'; return `${Math.floor(min / 60)}h ${pad(min % 60)}m`; },
    fy(s) { const d = T.parse(s); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `FY ${y}-${String(y + 1).slice(2)}`; },
    hm(iso) { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); },
    localDateOf(iso) { return T.ymd(new Date(iso)); },
    nthWeekdayOfMonth(s) { return Math.ceil(T.parse(s).getDate() / 7); }
  });

  /* ------------------------------------------------------------------ */
  /* Settings (configurable rules). No policy values are invented:       */
  /* unconfigured values are null and surfaced as "Not configured".      */
  /* ------------------------------------------------------------------ */
  ESS.DEFAULTS = {
    attendance: {
      shiftStart: '09:30', shiftEnd: '18:00', graceMinutes: 15,
      fullDayMinutes: 480, halfDayMinutes: 240, maxSessionHours: 16,
      weeklyOffDays: [0], saturdayRule: 'none', /* none | all | alt (2nd & 4th) */
      requireFace: true, requireFaceOnClockOut: true,
      clockSkewToleranceMin: 5, correctionWindowDays: 30
    },
    offices: [
      { id: 'uppal', name: 'Uppal', lat: null, lng: null, region: '' },
      { id: 'secunderabad', name: 'Secunderabad', lat: null, lng: null, region: '' }
    ],
    faceVerification: { mode: 'none', endpoint: '', authHeader: '', demoEnabled: true, tested: false, testedAt: null },
    email: { mode: 'mailto', endpoint: '', authHeader: '', hrEmail: '', financeEmail: '', tested: false, testedAt: null },
    backend: { mode: 'local', baseUrl: '' },
    workflow: {
      leave: ['manager', 'hr'], expense: ['manager', 'finance'], correction: ['manager'],
      requireRemarksOnReject: true, requireRemarksOnReturn: true, requireRemarksOnApprove: false,
      skipMissingManager: true
    },
    leave: { yearStartMonth: 1, allowCancelApproved: true },
    expense: {
      categories: [
        { name: 'Travel', limit: null, receiptAbove: null }, { name: 'Conveyance', limit: null, receiptAbove: null },
        { name: 'Meals', limit: null, receiptAbove: null }, { name: 'Accommodation', limit: null, receiptAbove: null },
        { name: 'Office Supplies', limit: null, receiptAbove: null }, { name: 'Other', limit: null, receiptAbove: null }
      ],
      maxFileMB: 5, maxClaimAgeDays: null, paymentMethods: ['Cash', 'Card', 'UPI', 'Bank Transfer', 'Company Card']
    },
    documents: { maxFileMB: 10 },
    roles: { hrUsers: [], financeUsers: [] }
  };

  const SECTION_PERM = {
    attendance: 'admin.attendance', offices: 'admin.settings', faceVerification: 'admin.settings',
    email: 'admin.settings', backend: 'admin.settings', workflow: 'admin.settings', roles: 'admin.settings',
    leave: 'admin.leave', expense: 'admin.expense', documents: 'admin.documents'
  };

  ESS.Settings = {
    cache: null,
    async load() {
      const rec = await ESS.Data.get(S.settings, 'config');
      this.cache = deepMerge(ESS.clone(ESS.DEFAULTS), rec ? rec.value : {});
      return this.cache;
    },
    get() { return this.cache || ESS.clone(ESS.DEFAULTS); },
    async update(section, value, note) {
      const perm = SECTION_PERM[section];
      ESS.require(perm, 'Unknown settings section', 'invalid');
      ESS.Auth.require(perm);
      const rec = (await ESS.Data.get(S.settings, 'config')) || { key: 'config', value: {} };
      const before = ESS.clone(this.get()[section]);
      rec.value[section] = value;
      rec.updatedAt = new Date().toISOString();
      await ESS.Data.put(S.settings, rec);
      await this.load();
      await ESS.Audit.log({ module: 'Settings', action: 'Settings Updated: ' + section, recordId: section, changes: { before, after: value }, note });
      return this.cache;
    }
  };

  /* ------------------------------------------------------------------ */
  /* Organisation: employee master + reporting hierarchy                 */
  /* ------------------------------------------------------------------ */
  ESS.Org = {
    emps: [], byCode: new Map(), byName: new Map(), cfg: new Map(), _mgr: new Map(), _reports: new Map(),
    async rebuild() {
      const d = global.db || (typeof window !== 'undefined' ? window.db : null) || (typeof db !== 'undefined' ? db : null);
      const stores = (typeof window !== 'undefined' ? window.STORES : null) || global.STORES || (typeof STORES !== 'undefined' ? STORES : {});
      this.emps = await d.getAll(stores.employees);
      this.byCode = new Map(); const nameCount = new Map(); this.byName = new Map();
      this.emps.forEach(e => {
        this.byCode.set(String(e.EmployeeCode).toUpperCase(), e);
        const n = (e.EmployeeName || '').trim().toLowerCase();
        nameCount.set(n, (nameCount.get(n) || 0) + 1); this.byName.set(n, e);
      });
      nameCount.forEach((c, n) => { if (c > 1) this.byName.delete(n); }); // ambiguous names are not resolvable
      this.cfg = new Map((await ESS.Data.getAll(S.empCfg)).map(c => [c.EmployeeCode, c]));
      this._mgr = new Map(); this._reports = new Map();
      this.emps.forEach(e => {
        const m = this._resolveManager(e);
        if (m) { this._mgr.set(e.EmployeeCode, m.EmployeeCode); (this._reports.get(m.EmployeeCode) || this._reports.set(m.EmployeeCode, []).get(m.EmployeeCode)).push(e.EmployeeCode); }
      });
    },
    _resolveManager(e) {
      const c = this.cfg.get(e.EmployeeCode);
      let raw = c && c.managerCode ? c.managerCode : (e.ReportingManager || '');
      raw = String(raw).trim(); if (!raw) return null;
      let m = /^PRI\d+$/i.test(raw) ? this.byCode.get(raw.toUpperCase()) : this.byName.get(raw.toLowerCase());
      if (!m && c && c.managerCode) m = this.byCode.get(String(c.managerCode).toUpperCase());
      return m && m.EmployeeCode !== e.EmployeeCode ? m : null;
    },
    isActive(e) { return e && !['Resigned', 'Terminated'].includes(e.EmploymentStatus); },
    active() { return this.emps.filter(e => this.isActive(e)); },
    get(code) { return code ? this.byCode.get(String(code).toUpperCase()) || null : null; },
    managerOf(code) { const m = this._mgr.get(code); return m ? this.get(m) : null; },
    managerSource(code) { const c = this.cfg.get(code); const e = this.get(code); return c && c.managerCode ? 'ESS reporting structure' : (e && e.ReportingManager ? 'Employee master' : null); },
    directReports(code) { return (this._reports.get(code) || []).map(c => this.get(c)).filter(Boolean); },
    ancestors(code) { const out = []; let cur = code, guard = 0; while (this._mgr.has(cur) && guard++ < 25) { cur = this._mgr.get(cur); if (out.includes(cur)) break; out.push(cur); } return out; },
    isAncestor(mgrCode, empCode) { return this.ancestors(empCode).includes(mgrCode); },
    descendants(code) {
      const out = []; const q = [code]; const seen = new Set([code]);
      while (q.length) { (this._reports.get(q.shift()) || []).forEach(c => { if (!seen.has(c)) { seen.add(c); out.push(c); q.push(c); } }); }
      return out;
    },
    calendarTags(code) {
      const e = this.get(code); const c = this.cfg.get(code); const t = [];
      if (e && e.HQ) t.push(String(e.HQ).toLowerCase());
      if (c && c.calendarOffice) t.push(String(c.calendarOffice).toLowerCase());
      return t;
    },
    async setConfig(empCode, patch) {
      ESS.Auth.require('admin.settings');
      const cur = this.cfg.get(empCode) || { EmployeeCode: empCode };
      const next = Object.assign({}, cur, patch, { updatedBy: ESS.Auth.actor().code, updatedAt: new Date().toISOString() });
      await ESS.Data.put(S.empCfg, next);
      await ESS.Audit.log({ module: 'Reporting Structure', action: 'Employee ESS Config Updated', recordId: empCode, employeeCode: empCode, changes: { before: cur, after: next } });
      await this.rebuild();
    }
  };

  /* ------------------------------------------------------------------ */
  /* Auth / RBAC (development identity — NOT real authentication)        */
  /* ------------------------------------------------------------------ */
  const PERMS = {
    self: ['employee'],
    'approve.manager': ['manager'], 'approve.hr': ['hr'], 'approve.finance': ['finance'],
    'admin.attendance': ['hr'], 'admin.leave': ['hr'], 'admin.expense': ['hr', 'finance'],
    'admin.holiday': ['hr'], 'admin.documents': ['hr'], 'admin.settings': ['hr'], 'view.all': ['hr']
  };
  ESS.Auth = {
    _actor: null,
    mode: 'development-identity',
    actor() { return this._actor; },
    isSignedIn() { return !!this._actor; },
    has(role) { return !!this._actor && this._actor.roles.has(role); },
    can(perm) {
      const a = this._actor; if (!a) return false;
      if (a.roles.has('admin')) return true;
      return (PERMS[perm] || []).some(r => a.roles.has(r));
    },
    require(perm) { if (!this.can(perm)) throw new ESSError('You are not authorised to perform this action.', 'forbidden'); },
    /** Employees may only touch their own records; HR may access all. */
    requireSelfOrHR(empCode) {
      const a = this._actor;
      if (!a) throw new ESSError('Not signed in.', 'forbidden');
      if (a.code === empCode || this.can('view.all')) return;
      throw new ESSError('You can only access your own records.', 'forbidden');
    },
    _build(code, kind) {
      if (kind === 'admin') {
        return { code: 'HR-ADMIN', name: 'HR Admin', kind: 'admin', emp: null, designation: 'Portal Administrator', roles: new Set(['admin', 'hr', 'finance']) };
      }
      const emp = ESS.Org.get(code); if (!emp) return null;
      const cfg = ESS.Settings.get().roles; const roles = new Set(['employee']);
      if (ESS.Org.directReports(emp.EmployeeCode).length) roles.add('manager');
      if ((cfg.hrUsers || []).includes(emp.EmployeeCode)) roles.add('hr');
      if ((cfg.financeUsers || []).includes(emp.EmployeeCode)) roles.add('finance');
      return { code: emp.EmployeeCode, name: emp.EmployeeName, kind: 'employee', emp, designation: emp.Designation, roles };
    },
    signIn(code, kind) {
      const a = this._build(code, kind); if (!a) throw new ESSError('Employee not found.', 'notfound');
      this._actor = a;
      try { sessionStorage.setItem('ess.session', JSON.stringify({ code: a.code, kind: a.kind })); } catch (e) { /* ignore */ }
      ESS.Audit.log({ module: 'Session', action: 'Sign In (development identity)', recordId: a.code, employeeCode: a.kind === 'employee' ? a.code : '' }).catch(() => {});
      return a;
    },
    restore() {
      try {
        const s = JSON.parse(sessionStorage.getItem('ess.session') || 'null');
        if (s) { const a = this._build(s.kind === 'admin' ? 'HR-ADMIN' : s.code, s.kind); if (a) { this._actor = a; return a; } }
      } catch (e) { /* ignore */ }
      return null;
    },
    refresh() { if (this._actor) { const a = this._build(this._actor.kind === 'admin' ? 'HR-ADMIN' : this._actor.code, this._actor.kind); if (a) this._actor = a; } },
    signOut() {
      const a = this._actor; this._actor = null;
      try { sessionStorage.removeItem('ess.session'); } catch (e) { /* ignore */ }
      if (a) ESS.Audit.log({ module: 'Session', action: 'Sign Out', recordId: a.code, employeeCode: a.kind === 'employee' ? a.code : '', actorOverride: a }).catch(() => {});
    }
  };

  /* ------------------------------------------------------------------ */
  /* Tamper-evident, append-only audit trail (SHA-256 hash chain)        */
  /* ------------------------------------------------------------------ */
  async function sha256(str) {
    if (global.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'fnv' + (h >>> 0).toString(16);
  }
  ESS.Audit = {
    _q: Promise.resolve(), _last: null,
    log(e) {
      const actor = e.actorOverride || ESS.Auth.actor() || { code: 'SYSTEM', name: 'System', roles: new Set() };
      const run = async () => {
        if (this._last === null) {
          const all = await ESS.Data.adapter.getAll(S.audit);
          this._last = all.length ? all[all.length - 1].Hash : 'GENESIS';
        }
        const entry = {
          Timestamp: new Date().toISOString(), ActorCode: actor.code, ActorName: actor.name,
          ActorRole: [...actor.roles].join(','), Module: e.module || '', Action: e.action || '',
          RecordId: e.recordId || '', EmployeeCode: e.employeeCode || '', Changes: e.changes || null, Note: e.note || '',
          PrevHash: this._last
        };
        entry.Hash = await sha256(JSON.stringify(entry));
        await ESS.Data.adapter.add(S.audit, entry);
        this._last = entry.Hash;
        try { // mirror into the existing HR audit trail so profile Activity tabs show ESS events
          const d = global.db || (typeof window !== 'undefined' ? window.db : null) || (typeof db !== 'undefined' ? db : null);
          if (d && d.logAudit) {
            await d.logAudit({ Module: 'ESS · ' + entry.Module, Action: entry.Action, Record: entry.RecordId, Field: '', OldValue: '', NewValue: entry.Note || '', EmployeeCode: entry.EmployeeCode, User: actor.name });
          }
        } catch (er) { /* non-fatal */ }
      };
      this._q = this._q.then(run, run).catch(err => console.error('[ESS audit]', err));
      return this._q;
    },
    async query(filter) {
      ESS.Auth.require('view.all');
      let rows = await ESS.Data.adapter.getAll(S.audit);
      filter = filter || {};
      if (filter.employeeCode) rows = rows.filter(r => r.EmployeeCode === filter.employeeCode);
      if (filter.module) rows = rows.filter(r => r.Module === filter.module);
      if (filter.text) { const t = filter.text.toLowerCase(); rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(t)); }
      return rows.reverse();
    },
    async verify() {
      ESS.Auth.require('view.all');
      const rows = await ESS.Data.adapter.getAll(S.audit);
      let prev = 'GENESIS';
      for (let i = 0; i < rows.length; i++) {
        const { id, Hash, ...rest } = rows[i];
        if (rest.PrevHash !== prev || (await sha256(JSON.stringify(rest))) !== Hash) return { ok: false, count: rows.length, brokenAt: id };
        prev = Hash;
      }
      return { ok: true, count: rows.length };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Notifications (in-app). 'ROLE:hr' / 'ROLE:finance' = shared queues  */
  /* ------------------------------------------------------------------ */
  ESS.Notify = {
    async push(n) {
      if (n.key) { const ex = await ESS.Data.get(S.notifications, n.key); if (ex) return ex; }
      const rec = {
        id: n.key || ESS.uid('NT'), RecipientCode: n.to, type: n.type || 'info', title: n.title, body: n.body || '',
        link: n.link || null, createdAt: new Date().toISOString(), readAt: null, readBy: {}
      };
      await ESS.Data.put(S.notifications, rec);
      return rec;
    },
    buildOps(list) { // returns batch ops (for atomic workflow transitions)
      return list.filter(Boolean).map(n => ({
        op: 'put', store: S.notifications, value: {
          id: ESS.uid('NT'), RecipientCode: n.to, type: n.type || 'info', title: n.title, body: n.body || '',
          link: n.link || null, createdAt: new Date().toISOString(), readAt: null, readBy: {}
        }
      }));
    },
    _mineKeys() { const a = ESS.Auth.actor(); if (!a) return []; const k = [a.code]; if (a.roles.has('hr')) k.push('ROLE:hr'); if (a.roles.has('finance')) k.push('ROLE:finance'); return k; },
    isRead(n) { const a = ESS.Auth.actor(); return String(n.RecipientCode).startsWith('ROLE:') ? !!(n.readBy && n.readBy[a.code]) : !!n.readAt; },
    async mine() {
      const keys = this._mineKeys(); let all = [];
      for (const k of keys) all = all.concat(await ESS.Data.byIndex(S.notifications, 'RecipientCode', k));
      return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async unreadCount() { return (await this.mine()).filter(n => !this.isRead(n)).length; },
    async markRead(id) {
      const n = await ESS.Data.get(S.notifications, id); if (!n) return;
      ESS.require(this._mineKeys().includes(n.RecipientCode), 'Not your notification.', 'forbidden');
      const a = ESS.Auth.actor();
      if (String(n.RecipientCode).startsWith('ROLE:')) n.readBy = Object.assign({}, n.readBy, { [a.code]: new Date().toISOString() });
      else n.readAt = new Date().toISOString();
      await ESS.Data.put(S.notifications, n);
    },
    async markAllRead() { for (const n of await this.mine()) if (!this.isRead(n)) await this.markRead(n.id); }
  };

  /* ------------------------------------------------------------------ */
  /* Email: editable drafts → mailto fallback or configured server send. */
  /* States never over-claim: draft → draft-opened → (delivered only if  */
  /* a configured & tested server confirms).                              */
  /* ------------------------------------------------------------------ */
  ESS.Email = {
    STATE: {
      draft: { label: 'Draft saved', tone: 'neutral', hint: 'Not sent. Review and open in your mail app.' },
      'draft-opened': { label: 'Draft opened in mail app', tone: 'info', hint: 'Delivery cannot be confirmed from the browser.' },
      delivered: { label: 'Delivered (server confirmed)', tone: 'success', hint: '' },
      failed: { label: 'Send failed', tone: 'danger', hint: 'Use the mail-app fallback or retry.' }
    },
    async create(d) {
      const rec = Object.assign({
        id: ESS.uid('EM'), to: '', cc: '', subject: '', body: '', requestId: '', kind: '', employeeCode: '', purpose: '',
        state: 'draft', createdAt: new Date().toISOString(), createdBy: (ESS.Auth.actor() || {}).code || 'SYSTEM', events: []
      }, d);
      rec.events.push({ at: rec.createdAt, state: 'draft' });
      await ESS.Data.put(S.emails, rec);
      return rec;
    },
    async get(id) { return ESS.Data.get(S.emails, id); },
    async forRequest(requestId) { return (await ESS.Data.byIndex(S.emails, 'requestId', requestId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); },
    async update(id, patch) {
      const r = await this.get(id); ESS.require(r, 'Email draft not found', 'notfound');
      Object.assign(r, patch); await ESS.Data.put(S.emails, r); return r;
    },
    async _mark(r, state, extra) { r.state = state; r.events.push(Object.assign({ at: new Date().toISOString(), state }, extra || {})); await ESS.Data.put(S.emails, r); return r; },
    mailtoUrl(r) {
      const q = [];
      if (r.cc) q.push('cc=' + encodeURIComponent(r.cc));
      q.push('subject=' + encodeURIComponent(r.subject));
      q.push('body=' + encodeURIComponent(r.body));
      return 'mailto:' + encodeURIComponent(r.to || '').replace(/%2C/gi, ',').replace(/%40/g, '@') + '?' + q.join('&');
    },
    async openMailto(id) {
      const r = await this.get(id); ESS.require(r, 'Email draft not found', 'notfound');
      const url = this.mailtoUrl(r);
      const a = document.createElement('a'); a.href = url; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
      await this._mark(r, r.state === 'delivered' ? 'delivered' : 'draft-opened', { via: 'mailto', urlLength: url.length });
      await ESS.Audit.log({ module: 'Email', action: 'Email Draft Opened in Mail App', recordId: r.requestId, employeeCode: r.employeeCode, note: r.subject });
      return { urlLength: url.length };
    },
    serverReady() { const c = ESS.Settings.get().email; return c.mode === 'remote' && !!c.endpoint && c.tested === true; },
    async sendRemote(id) {
      const c = ESS.Settings.get().email;
      ESS.require(this.serverReady(), 'Email delivery service is not configured and tested.', 'unavailable');
      const r = await this.get(id);
      try {
        const resp = await fetch(c.endpoint, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, c.authHeader ? { Authorization: c.authHeader } : {}), body: JSON.stringify({ to: r.to, cc: r.cc, subject: r.subject, body: r.body, reference: r.requestId }) });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const j = await resp.json().catch(() => ({}));
        if (j.delivered === true || j.status === 'delivered' || j.accepted === true) { await this._mark(r, 'delivered', { via: 'server', messageId: j.messageId || null }); }
        else { await this._mark(r, 'draft', { via: 'server', note: 'Accepted but delivery not confirmed' }); }
      } catch (err) { await this._mark(r, 'failed', { via: 'server', error: String(err.message || err) }); }
      await ESS.Audit.log({ module: 'Email', action: 'Email Server Send Attempted', recordId: r.requestId, employeeCode: r.employeeCode, note: r.subject });
      return this.get(id);
    },
    addressOf(code) { const e = ESS.Org.get(code); return e && e.Email ? e.Email : ''; },
    /** Professional pre-drafted bodies. */
    templates: {
      leaveSubmitted(req, emp, toName) {
        return {
          subject: `Leave Request ${req.id} — ${emp.EmployeeName} (${emp.EmployeeCode}) — ${req.type} ${ESS.T.date(req.startDate)}${req.endDate !== req.startDate ? ' to ' + ESS.T.date(req.endDate) : ''}`,
          body: `Dear ${toName || 'Sir/Madam'},\n\nI would like to request leave as per the details below and request your approval.\n\n` +
            `Reference       : ${req.id}\nEmployee        : ${emp.EmployeeName} (${emp.EmployeeCode})\nDesignation     : ${emp.Designation || '-'}\nDivision / HQ   : ${emp.Division || '-'} / ${emp.HQ || '-'}\n` +
            `Leave type      : ${req.type}\nFrom            : ${ESS.T.date(req.startDate)}\nTo              : ${ESS.T.date(req.endDate)}\nNumber of days  : ${req.days}${req.halfDay ? ' (half day — ' + req.halfDay + ')' : ''}\nReason          : ${req.reason}\n\n` +
            `Kindly review the request in the Primus ESS portal under Approvals using the reference above.\n\nThank you.\n\nRegards,\n${emp.EmployeeName}\n${emp.EmployeeCode} | ${emp.Designation || ''}`
        };
      },
      expenseSubmitted(c, emp, toName) {
        return {
          subject: `Expense Claim ${c.id} — ${emp.EmployeeName} (${emp.EmployeeCode}) — ${ESS.inr(c.amount)}`,
          body: `Dear ${toName || 'Sir/Madam'},\n\nPlease review and approve the expense claim below.\n\n` +
            `Reference    : ${c.id}\nEmployee     : ${emp.EmployeeName} (${emp.EmployeeCode})\nTitle        : ${c.title}\nCategory     : ${c.category}\nExpense date : ${ESS.T.date(c.expenseDate)}\nAmount       : ${ESS.inr(c.amount)}\nPurpose      : ${c.purpose}\nReceipts     : ${(c.receiptIds || []).length} attached in the portal\n\n` +
            `Kindly review it in the Primus ESS portal using the reference above.\n\nRegards,\n${emp.EmployeeName}\n${emp.EmployeeCode} | ${emp.Designation || ''}`
        };
      },
      correctionSubmitted(c, emp, toName) {
        return {
          subject: `Attendance Correction ${c.id} — ${emp.EmployeeName} (${emp.EmployeeCode}) — ${ESS.T.date(c.date)}`,
          body: `Dear ${toName || 'Sir/Madam'},\n\nI request an attendance correction for ${ESS.T.date(c.date)}.\n\nReference     : ${c.id}\nProposed in   : ${c.proposedIn ? ESS.T.time(c.proposedIn) : '—'}\nProposed out  : ${c.proposedOut ? ESS.T.time(c.proposedOut) : '—'}\nReason        : ${c.reason}\n\nKindly review it in the Primus ESS portal.\n\nRegards,\n${emp.EmployeeName}\n${emp.EmployeeCode}`
        };
      },
      decision(kind, rec, emp, action, actor, remarks, toName) {
        const verb = { approve: 'approved', reject: 'rejected', return: 'returned for correction' }[action];
        const what = { leave: 'leave request', expense: 'expense claim', correction: 'attendance correction request' }[kind];
        return {
          subject: `${kind === 'leave' ? 'Leave' : kind === 'expense' ? 'Expense' : 'Attendance Correction'} ${rec.id} — ${verb}`,
          body: `Dear ${toName || emp.EmployeeName},\n\nYour ${what} ${rec.id} has been ${verb} by ${actor.name}.\n` + (remarks ? `\nReviewer remarks: ${remarks}\n` : '') + `\nYou can view the full approval timeline in the Primus ESS portal.\n\nRegards,\n${actor.name}`
        };
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /* Approval workflow engine (leave • expense • attendance correction)  */
  /* ------------------------------------------------------------------ */
  const KIND_STORE = { leave: S.leaveApps, expense: S.claims, correction: S.corrections };
  const ROLE_STATUS = { manager: 'Pending Manager Approval', hr: 'Pending HR Approval', finance: 'Pending Finance Approval' };
  ESS.Hooks = { correction: {} };

  ESS.Flow = {
    PENDING: Object.values(ROLE_STATUS),
    isPending(st) { return this.PENDING.includes(st); },
    storeOf(kind) { return KIND_STORE[kind]; },
    buildStages(kind, empCode) {
      const wf = ESS.Settings.get().workflow; const cfg = (wf[kind] || ['manager', 'hr']).slice();
      const stages = cfg.map(role => {
        const st = { role, state: 'pending' };
        if (role === 'manager') {
          const m = ESS.Org.managerOf(empCode);
          if (m) { st.approverCode = m.EmployeeCode; st.approverName = m.EmployeeName; }
          else if (wf.skipMissingManager) { st.state = 'skipped'; st.note = 'Reporting manager not configured — stage skipped'; }
          else throw new ESSError('No reporting manager is configured for you. Please contact HR.', 'config');
        }
        return st;
      });
      if (!stages.some(s => s.state === 'pending')) stages.push({ role: 'hr', state: 'pending', note: 'Routed to HR — no reporting manager configured' });
      return stages;
    },
    /** Moves a draft/returned record into the workflow (mutates and returns rec). */
    start(kind, rec, note) {
      const now = new Date().toISOString(); const a = ESS.Auth.actor();
      rec.stages = this.buildStages(kind, rec.EmployeeCode);
      rec.currentStage = rec.stages.findIndex(s => s.state === 'pending');
      rec.status = ROLE_STATUS[rec.stages[rec.currentStage].role];
      rec.submittedAt = rec.submittedAt || now; rec.lastSubmittedAt = now;
      rec.timeline = rec.timeline || [];
      rec.timeline.push({ at: now, actor: a.name, actorCode: a.code, action: note || 'Submitted', status: 'Submitted', remarks: '' });
      rec.stages.forEach(s => { if (s.state === 'skipped') rec.timeline.push({ at: now, actor: 'System', actorCode: 'SYSTEM', action: s.note, status: rec.status, remarks: '' }); });
      return rec;
    },
    stageLabel(stage) { return { manager: 'Reporting Manager', hr: 'HR', finance: 'Finance' }[stage.role]; },
    currentStage(rec) { return rec.currentStage != null && rec.stages ? rec.stages[rec.currentStage] : null; },
    canAct(rec, actor) {
      actor = actor || ESS.Auth.actor(); if (!actor) return false;
      const st = this.currentStage(rec); if (!st || st.state !== 'pending') return false;
      if (rec.EmployeeCode === actor.code) return false; // no self-approval
      if (actor.roles.has('admin')) return true;
      if (st.role === 'manager') return actor.roles.has('manager') && ESS.Org.isAncestor(actor.code, rec.EmployeeCode);
      if (st.role === 'hr') return actor.roles.has('hr');
      if (st.role === 'finance') return actor.roles.has('finance');
      return false;
    },
    recipientsFor(stage) {
      if (!stage) return [];
      if (stage.role === 'manager') return stage.approverCode ? [stage.approverCode] : [];
      return ['ROLE:' + stage.role];
    },
    async get(kind, id) { return ESS.Data.get(KIND_STORE[kind], id); },
    /** Approve / reject / return with remarks. Atomic: request + approval history + notifications. */
    async decide(kind, id, action, remarks) {
      const actor = ESS.Auth.actor(); ESS.require(actor, 'Not signed in', 'forbidden');
      ESS.require(['approve', 'reject', 'return'].includes(action), 'Invalid action');
      const wf = ESS.Settings.get().workflow; remarks = (remarks || '').trim();
      if (action === 'reject' && wf.requireRemarksOnReject) ESS.require(remarks, 'Remarks are required when rejecting.');
      if (action === 'return' && wf.requireRemarksOnReturn) ESS.require(remarks, 'Remarks are required when returning for correction.');
      if (action === 'approve' && wf.requireRemarksOnApprove) ESS.require(remarks, 'Remarks are required when approving.');
      const rec = await this.get(kind, id); ESS.require(rec, 'Request not found', 'notfound');
      ESS.require(this.canAct(rec, actor), 'This request is not awaiting your action (it may already have been actioned).', 'forbidden');
      const before = rec.status; const now = new Date().toISOString(); const st = rec.stages[rec.currentStage];
      st.state = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'returned';
      st.actorCode = actor.code; st.actorName = actor.name; st.at = now; st.remarks = remarks;
      let next = -1;
      if (action === 'approve') {
        next = rec.stages.findIndex((s, i) => i > rec.currentStage && s.state === 'pending');
        if (next >= 0) { rec.currentStage = next; rec.status = ROLE_STATUS[rec.stages[next].role]; }
        else { rec.currentStage = null; rec.status = 'Approved'; rec.decidedAt = now; }
      } else { rec.currentStage = null; rec.status = action === 'reject' ? 'Rejected' : 'Returned for Correction'; rec.decidedAt = now; }
      const verb = { approve: 'Approved', reject: 'Rejected', return: 'Returned for Correction' }[action];
      rec.timeline.push({ at: now, actor: actor.name, actorCode: actor.code, action: `${verb} (${this.stageLabel(st)})`, status: rec.status, remarks });
      rec.updatedAt = now;
      const emp = ESS.Org.get(rec.EmployeeCode);
      const label = { leave: 'Leave', expense: 'Expense claim', correction: 'Attendance correction' }[kind];
      const link = { page: kind === 'leave' ? 'leave' : kind === 'expense' ? 'expenses' : 'attendance', id: rec.id };
      const ops = [
        { op: 'put', store: KIND_STORE[kind], value: rec },
        { op: 'put', store: S.approvals, value: { id: ESS.uid('AP'), RequestId: rec.id, Kind: kind, EmployeeCode: rec.EmployeeCode, ActorCode: actor.code, ActorName: actor.name, Role: st.role, Action: action, Remarks: remarks, At: now, From: before, To: rec.status } }
      ];
      const notes = [{ to: rec.EmployeeCode, type: action === 'approve' ? 'success' : action === 'reject' ? 'danger' : 'warning', title: `${label} ${rec.id} ${verb.toLowerCase()}`, body: remarks ? `${actor.name}: ${remarks}` : `Status: ${rec.status}`, link }];
      if (next >= 0) this.recipientsFor(rec.stages[next]).forEach(to => notes.push({ to, type: 'info', title: `${label} ${rec.id} awaiting your approval`, body: `${emp ? emp.EmployeeName : rec.EmployeeCode} — ${rec.title || rec.type || ''}`, link: { page: 'approvals', id: rec.id } }));
      ops.push(...ESS.Notify.buildOps(notes));
      const hook = ESS.Hooks[kind] && ESS.Hooks[kind][rec.status];
      if (hook) ops.push(...(await hook(rec)));
      await ESS.Data.batch(ops);
      await ESS.Audit.log({ module: label, action: `${label} ${verb}`, recordId: rec.id, employeeCode: rec.EmployeeCode, changes: { status: [before, rec.status] }, note: remarks });
      // Tell the server (voids any live e-mail link, sends the employee's automatic decision e-mail,
      // and — if there is a next stage — issues + sends that approver's fresh 24h link).
      const report = ESS.Remote ? await ESS.Remote.reportLocalDecision(rec, rec.stages.indexOf(st), actor, action, remarks) : null;
      // editable notification drafts (employee + next approver)
      const drafts = [];
      const empTpl = ESS.Email.templates.decision(kind, rec, emp || { EmployeeName: rec.EmployeeCode }, action, actor, remarks);
      drafts.push(await ESS.Email.create({ requestId: rec.id, kind, employeeCode: rec.EmployeeCode, purpose: 'Decision notice to employee', to: ESS.Email.addressOf(rec.EmployeeCode), cc: '', subject: empTpl.subject, body: empTpl.body }));
      if (next >= 0 && emp) {
        const ns = rec.stages[next]; const cfgE = ESS.Settings.get().email;
        const tpl = kind === 'leave' ? ESS.Email.templates.leaveSubmitted(rec, emp, this.stageLabel(ns)) : kind === 'expense' ? ESS.Email.templates.expenseSubmitted(rec, emp, this.stageLabel(ns)) : ESS.Email.templates.correctionSubmitted(rec, emp, this.stageLabel(ns));
        const base = { requestId: rec.id, kind, employeeCode: rec.EmployeeCode, purpose: `Request for ${this.stageLabel(ns)} approval`, to: ns.role === 'manager' ? ESS.Email.addressOf(ns.approverCode) : (ns.role === 'hr' ? cfgE.hrEmail : cfgE.financeEmail), subject: tpl.subject, body: tpl.body };
        if (ESS.Remote && report && report.nextDraft) drafts.push(await ESS.Remote.draftFromNext(base, report.nextDraft));
        else if (ESS.Remote) drafts.push(await ESS.Remote.registerDraft(kind, rec, emp, base));
        else drafts.push(await ESS.Email.create(base));
      }
      return { rec, drafts };
    },
    /**
     * Applies a decision an approver made through a secure e-mail link (server-authoritative result).
     * Idempotent: returns { found, applied, rec }. found=false when this browser has no local copy.
     */
    async applyRemote(kind, id, d) {
      const rec = await this.get(kind, id);
      if (!rec) return { found: false, applied: false };
      rec.timeline = rec.timeline || [];
      if (rec.timeline.some(t => t.remoteSeq === d.seq)) return { found: true, applied: false, rec };
      const st = rec.stages && rec.stages[d.stageIndex];
      if (!st || st.state !== 'pending' || rec.currentStage !== d.stageIndex) return { found: true, applied: false, rec }; // already decided in-portal
      const before = rec.status; const now = d.at || new Date().toISOString();
      const actorName = d.actorName || d.actorEmail;
      st.state = d.action === 'approve' ? 'approved' : d.action === 'reject' ? 'rejected' : 'returned';
      st.actorCode = ''; st.actorName = actorName; st.actorEmail = d.actorEmail; st.at = now; st.remarks = d.remarks || ''; st.via = 'email-link';
      let next = -1;
      if (d.action === 'approve') {
        next = rec.stages.findIndex((s, i) => i > d.stageIndex && s.state === 'pending');
        if (next >= 0) { rec.currentStage = next; rec.status = ROLE_STATUS[rec.stages[next].role]; }
        else { rec.currentStage = null; rec.status = 'Approved'; rec.decidedAt = now; }
      } else { rec.currentStage = null; rec.status = d.action === 'reject' ? 'Rejected' : 'Returned for Correction'; rec.decidedAt = now; }
      const verb = { approve: 'Approved', reject: 'Rejected', return: 'Returned for Correction' }[d.action];
      rec.timeline.push({ at: now, actor: actorName, actorCode: '', actorEmail: d.actorEmail, action: `${verb} (${this.stageLabel(st)}) via e-mail link`, status: rec.status, remarks: d.remarks || '', remoteSeq: d.seq });
      rec.updatedAt = new Date().toISOString();
      const label = { leave: 'Leave', expense: 'Expense claim', correction: 'Attendance correction' }[kind];
      const link = { page: kind === 'leave' ? 'leave' : kind === 'expense' ? 'expenses' : 'attendance', id: rec.id };
      const emp = ESS.Org.get(rec.EmployeeCode);
      const ops = [
        { op: 'put', store: KIND_STORE[kind], value: rec },
        { op: 'put', store: S.approvals, value: { id: ESS.uid('AP'), RequestId: rec.id, Kind: kind, EmployeeCode: rec.EmployeeCode, ActorCode: d.actorEmail, ActorName: actorName, Role: st.role, Action: d.action, Remarks: d.remarks || '', At: now, From: before, To: rec.status, Via: 'email-link' } }
      ];
      const notes = [{ to: rec.EmployeeCode, type: d.action === 'approve' ? 'success' : d.action === 'reject' ? 'danger' : 'warning', title: `${label} ${rec.id} ${verb.toLowerCase()}`, body: `${d.actorEmail}${d.remarks ? ': ' + d.remarks : ''} — status: ${rec.status}`, link }];
      if (next >= 0) this.recipientsFor(rec.stages[next]).forEach(to => notes.push({ to, type: 'info', title: `${label} ${rec.id} awaiting your approval`, body: `${emp ? emp.EmployeeName : rec.EmployeeCode} — ${rec.title || rec.type || ''}`, link: { page: 'approvals', id: rec.id } }));
      ops.push(...ESS.Notify.buildOps(notes));
      const hook = ESS.Hooks[kind] && ESS.Hooks[kind][rec.status];
      if (hook) ops.push(...(await hook(rec)));
      await ESS.Data.batch(ops);
      await ESS.Audit.log({ module: label, action: `${label} ${verb} via e-mail link`, recordId: rec.id, employeeCode: rec.EmployeeCode, changes: { status: [before, rec.status] }, note: `Decided from ${d.actorEmail}${d.remarks ? ' — ' + d.remarks : ''}`, actorOverride: { code: d.actorEmail, name: actorName, roles: new Set(['approver-link']) } });
      return { found: true, applied: true, rec };
    },
    /** Employee withdraws/cancels while pending (or approved-but-future leave when allowed). */
    async cancel(kind, id, reason) {
      const actor = ESS.Auth.actor(); const rec = await this.get(kind, id); ESS.require(rec, 'Request not found', 'notfound');
      ESS.require(rec.EmployeeCode === actor.code, 'Only the requester can cancel this request.', 'forbidden');
      ESS.require(['Draft', 'Returned for Correction', ...this.PENDING].includes(rec.status) || (kind === 'leave' && rec.status === 'Approved'), 'This request can no longer be cancelled.', 'state');
      if (kind === 'leave' && rec.status === 'Approved') {
        ESS.require(ESS.Settings.get().leave.allowCancelApproved, 'Cancelling approved leave is not permitted by policy.', 'state');
        ESS.require(rec.startDate > ESS.T.today(), 'Leave that has already started cannot be cancelled online. Contact HR.', 'state');
      }
      const before = rec.status; const now = new Date().toISOString();
      rec.status = 'Cancelled'; rec.currentStage = null; rec.cancelledAt = now; rec.updatedAt = now;
      rec.timeline = rec.timeline || []; rec.timeline.push({ at: now, actor: actor.name, actorCode: actor.code, action: kind === 'expense' ? 'Withdrawn by employee' : 'Cancelled by employee', status: 'Cancelled', remarks: reason || '' });
      const notes = [];
      (rec.stages || []).forEach(s => { if (s.state === 'approved' || s.state === 'pending') this.recipientsFor(s).forEach(to => notes.push({ to, type: 'warning', title: `${kind === 'leave' ? 'Leave' : kind === 'expense' ? 'Expense claim' : 'Request'} ${rec.id} cancelled by employee`, body: reason || '', link: { page: 'approvals', id: rec.id } })); });
      await ESS.Data.batch([{ op: 'put', store: KIND_STORE[kind], value: rec }, ...ESS.Notify.buildOps(notes)]);
      await ESS.Audit.log({ module: kind, action: 'Request Cancelled', recordId: rec.id, employeeCode: rec.EmployeeCode, changes: { status: [before, 'Cancelled'] }, note: reason });
      if (ESS.Remote) { try { await ESS.Remote.reportCancel(rec.id); } catch (e) { /* server copy will be voided on next contact */ } }
      return rec;
    }
  };
})(window);
