/* ==========================================================================
   PRIMUS REMEDIES — ESS — SECURE E-MAIL APPROVAL LINKS (client side)
   • Registers each submitted request with the portal server, which issues a
     24-hour single-use approve/reject link and e-mails it to the approver.
   • Pulls decisions made through those links back into the employee's ESS.
   • Mirrors in-portal decisions / cancellations so stale links stop working.
   ========================================================================== */
(function (global) {
  'use strict';
  const ESS = (global.ESS = global.ESS || {});

  async function api(method, url, body) {
    try {
      const resp = await fetch(url, {
        method, credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      let json = null; try { json = await resp.json(); } catch (e) { /* non-JSON */ }
      return { ok: resp.ok, status: resp.status, json: json || {} };
    } catch (err) { return { ok: false, status: 0, json: { error: String(err.message || err) } }; }
  }

  function describe(kind, rec) {
    if (kind === 'leave') {
      return {
        title: `${rec.type} leave`,
        lines: [
          { label: 'Leave type', value: rec.type },
          { label: 'From', value: ESS.T.date(rec.startDate) },
          { label: 'To', value: ESS.T.date(rec.endDate) },
          { label: 'Days', value: String(rec.days) + (rec.halfDay ? ` (half day — ${rec.halfDay})` : '') },
          { label: 'Reason', value: rec.reason || '—' }
        ]
      };
    }
    if (kind === 'expense') {
      return {
        title: rec.title,
        lines: [
          { label: 'Title', value: rec.title },
          { label: 'Category', value: rec.category },
          { label: 'Expense date', value: ESS.T.date(rec.expenseDate) },
          { label: 'Amount', value: ESS.inr(rec.amount) },
          { label: 'Purpose', value: rec.purpose || '—' },
          { label: 'Receipts', value: `${(rec.receiptIds || []).length} attached in ESS` }
        ]
      };
    }
    return {
      title: 'Attendance correction',
      lines: [
        { label: 'Date', value: ESS.T.date(rec.date) },
        { label: 'Proposed in', value: rec.proposedIn ? ESS.T.time(rec.proposedIn) : '—' },
        { label: 'Proposed out', value: rec.proposedOut ? ESS.T.time(rec.proposedOut) : '—' },
        { label: 'Reason', value: rec.reason || '—' }
      ]
    };
  }

  ESS.Remote = {
    TTL_HOURS: 24,

    /**
     * Registers the request (current approval stage) with the server and returns the e-mail
     * draft record. If the server is unreachable the plain, link-less draft is kept so the
     * employee is never blocked from submitting — the draft is flagged accordingly.
     */
    async registerDraft(kind, rec, emp, base) {
      const stage = ESS.Flow.currentStage(rec);
      if (stage) {
        const info = describe(kind, rec);
        const r = await api('POST', '/api/ess/approvals/register', {
          requestId: rec.id, kind, title: info.title, lines: info.lines,
          employee: { code: rec.EmployeeCode, name: emp ? emp.EmployeeName : rec.EmployeeCode, email: ESS.Email.addressOf(rec.EmployeeCode) },
          currentStage: rec.currentStage,
          stages: rec.stages.map(s => ({
            role: s.role, state: s.state, approverCode: s.approverCode || '', approverName: s.approverName || '',
            approverEmail: s.approverCode ? ESS.Email.addressOf(s.approverCode) : ''
          }))
        });
        if (r.ok && r.json.ok && !r.json.serverAhead) return this._draftFromServer(base, r.json);
        console.warn('[ESS] Secure approval link unavailable:', r.status, r.json.error || '');
      }
      return ESS.Email.create(Object.assign({}, base, { purpose: (base.purpose || '') + ' (no secure link — server unreachable)' }));
    },

    async _draftFromServer(base, j) {
      const draft = await ESS.Email.create(Object.assign({}, base, {
        to: j.to || base.to || '', subject: j.subject, body: j.body,
        purpose: (base.purpose || 'Approval request') + ` — secure link valid ${j.ttlHours || 24}h`,
        secureLink: true, linkExpiresAt: j.expiresAt, needsRecipient: !!j.needsRecipient
      }));
      if (j.delivered) await ESS.Email._mark(draft, 'delivered', { via: 'server', mode: j.mode });
      return ESS.Email.get(draft.id);
    },

    /** Used by Flow.decide when the server already issued + sent the next approver's link. */
    async draftFromNext(base, nd) {
      return this._draftFromServer(base, { ...nd, ttlHours: 24 });
    },

    /** Tell the server an in-portal decision was made, so any live e-mail link is voided. */
    async reportLocalDecision(rec, stageIndex, actor, action, remarks) {
      const r = await api('POST', `/api/ess/approvals/${encodeURIComponent(rec.id)}/local-decision`, {
        stageIndex, action, remarks: remarks || '', actorName: actor.name
      });
      return r.ok ? r.json : null;
    },
    async reportCancel(id) { await api('POST', `/api/ess/approvals/${encodeURIComponent(id)}/cancel`); },

    /** Apply decisions that approvers made through e-mail links to this employee's ESS. */
    async sync() {
      if (this._syncing) return 0;
      this._syncing = true;
      try {
        const r = await api('GET', '/api/ess/approvals/sync');
        if (!r.ok || !Array.isArray(r.json.items)) return 0;
        const ack = []; const applied = [];
        for (const item of r.json.items) {
          for (const d of item.decisions) {
            try {
              const out = await ESS.Flow.applyRemote(item.kind, item.requestId, d);
              if (out.found) ack.push({ requestId: item.requestId, seq: d.seq });
              if (out.applied) applied.push({ item, d, rec: out.rec });
            } catch (e) { console.warn('[ESS] could not apply remote decision', item.requestId, e); }
          }
        }
        if (ack.length) await api('POST', '/api/ess/approvals/sync/ack', { items: ack });
        if (applied.length) {
          applied.forEach(({ d, rec }) => {
            const verb = d.action === 'approve' ? 'approved' : d.action === 'reject' ? 'rejected' : 'returned';
            if (global.App && App.showToast) App.showToast(`${rec.id} ${verb} by ${d.actorEmail}`, d.action === 'approve' ? 'success' : 'warning');
          });
          if (global.App && global.State && /^ess-/.test(State.currentPage || '') && !document.querySelector('.modal-overlay.active, #modalOverlay.active')) App.navigate(State.currentPage);
        }
        if (ESS.Documents && ESS.Documents.syncFromServer) {
          const actor = ESS.Auth && ESS.Auth.actor && ESS.Auth.actor();
          if (actor && actor.code) {
            try { await ESS.Documents.syncFromServer(actor.code); } catch (e) { /* ignore */ }
          }
        }
        return applied.length;
      } finally { this._syncing = false; }
    },

    startAutoSync() {
      if (this._timer) return;
      const run = () => this.sync().catch(() => {});
      run();
      this._timer = setInterval(run, 20000);
      global.addEventListener('focus', run);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
    }
  };
})(window);
