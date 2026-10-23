/* ==========================================================================
   PRIMUS REMEDIES — ESS — APPROVAL CENTRE
   Reporting Manager & HR / Finance dashboards • Subordinate isolation •
   Pending leave, expenses, and punch corrections • Batch & single decisions •
   Remarks enforcement • Full timeline integration.
   ========================================================================== */
(function (global) {
  'use strict';
  const ESS = (global.ESS = global.ESS || {});
  const S = ESS.S;

  ESS.Approvals = {
    /**
     * Gets all requests currently awaiting action by the current actor.
     * Enforces reporting hierarchy: managers see only their direct and indirect reports.
     */
    async getPendingForActor() {
      const actor = ESS.Auth.actor();
      if (!actor) return { leaves: [], expenses: [], corrections: [], totalCount: 0 };

      const allLeaves = await ESS.Data.getAll(S.leaveApps);
      const allExpenses = await ESS.Data.getAll(S.claims);
      const allCorrections = await ESS.Data.getAll(S.corrections);

      const canActOn = (rec) => ESS.Flow.canAct(rec, actor);

      const pendingLeaves = allLeaves.filter(canActOn);
      const pendingExpenses = allExpenses.filter(canActOn);
      const pendingCorrections = allCorrections.filter(canActOn);

      return {
        leaves: pendingLeaves.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        expenses: pendingExpenses.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        corrections: pendingCorrections.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        totalCount: pendingLeaves.length + pendingExpenses.length + pendingCorrections.length
      };
    },

    /**
     * Gets recent decisions made by this actor or across the organization (for HR).
     */
    async getDecisionHistory() {
      const actor = ESS.Auth.actor();
      if (!actor) return [];

      const allApprovals = await ESS.Data.getAll(S.approvals);
      let list = [];

      if (actor.roles.has('admin') || actor.roles.has('hr')) {
        list = allApprovals;
      } else {
        list = allApprovals.filter(a => a.ActorCode === actor.code);
      }

      list.sort((a, b) => b.At.localeCompare(a.At));
      return list.slice(0, 50);
    },

    /**
     * Executes approval decision (Approve, Reject, or Return for Correction).
     */
    async decide(kind, id, action, remarks) {
      return ESS.Flow.decide(kind, id, action, remarks);
    }
  };
})(window);
