/* ==========================================================================
   PRIMUS REMEDIES — ESS — EXPENSE MANAGEMENT MODULE
   Drafts • Submissions • Receipt attachments in IndexedDB • Limits •
   Multi-stage approval (Manager -> Finance) • Reimbursed lifecycle •
   Immutable audit trail • Professional email pre-drafts.
   ========================================================================== */
(function (global) {
  'use strict';
  const ESS = (global.ESS = global.ESS || {});
  const S = ESS.S;

  ESS.Expense = {
    /**
     * File upload helper: saves receipt file to `ess_files` store as base64/blob metadata.
     */
    async uploadReceipt(file, ownerCode) {
      ESS.require(file, 'No file selected.');
      const maxMB = (ESS.Settings.get().expense || {}).maxFileMB || 5;
      if (file.size > maxMB * 1024 * 1024) {
        throw new ESS.Error(`File size exceeds maximum allowed limit of ${maxMB} MB.`, 'file_too_large');
      }

      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      if (!validTypes.includes(file.type)) {
        throw new ESS.Error('Unsupported file type. Only JPEG, PNG, WEBP, and PDF receipts are allowed.', 'invalid_file_type');
      }

      const fileId = ESS.uid('FIL');
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.readAsDataURL(file);
      });

      const fileRecord = {
        id: fileId,
        ownerCode: ownerCode,
        name: file.name,
        size: file.size,
        type: file.type,
        data: base64Data,
        uploadedAt: new Date().toISOString()
      };

      await ESS.Data.put(S.files, fileRecord);
      return fileRecord;
    },

    /**
     * Gets file by ID.
     */
    async getFile(fileId) {
      return ESS.Data.get(S.files, fileId);
    },

    /**
     * Creates or saves an expense claim draft.
     */
    async saveDraft({ id, empCode, title, category, expenseDate, amount, purpose, notes, receiptIds, paymentMethod, costCentre }) {
      const actor = ESS.Auth.actor();
      ESS.require(actor, 'Not signed in', 'auth');
      ESS.Auth.requireSelfOrHR(empCode);

      ESS.require((title || '').trim().length >= 3, 'Claim title must be at least 3 characters.');
      ESS.require(category, 'Expense category is required.');
      ESS.require(ESS.T.isYmd(expenseDate), 'Valid expense date is required.');
      ESS.require(expenseDate <= ESS.T.today(), 'Expense date cannot be in the future.');
      ESS.require(!isNaN(amount) && Number(amount) > 0, 'Expense amount must be a positive number.');

      // Check category configuration & limit
      const cfg = ESS.Settings.get().expense;
      const catObj = (cfg.categories || []).find(c => c.name.toLowerCase() === category.toLowerCase());
      if (catObj && catObj.limit != null && Number(amount) > catObj.limit) {
        throw new ESS.Error(`Amount exceeds the configured limit of ${ESS.inr(catObj.limit)} for category ${category}.`, 'limit_exceeded');
      }

      let existing = id ? await ESS.Data.get(S.claims, id) : null;
      if (existing) {
        ESS.require(['Draft', 'Returned for Correction'].includes(existing.status), 'Only drafts or returned claims can be edited.', 'state');
      }

      const claimId = existing ? existing.id : ESS.uid('EXP');
      const now = new Date().toISOString();
      const emp = ESS.Org.get(empCode);

      const claim = Object.assign({}, existing || {}, {
        id: claimId,
        EmployeeCode: empCode,
        employeeName: emp ? emp.EmployeeName : empCode,
        designation: emp ? emp.Designation : '',
        division: emp ? emp.Division : '',
        hq: emp ? emp.HQ : '',
        title: title.trim(),
        category: category,
        expenseDate: expenseDate,
        amount: Number(amount),
        purpose: (purpose || '').trim(),
        notes: (notes || '').trim(),
        receiptIds: receiptIds || (existing ? existing.receiptIds : []),
        paymentMethod: paymentMethod || 'Cash',
        costCentre: costCentre || '',
        status: existing && existing.status === 'Returned for Correction' ? 'Returned for Correction' : 'Draft',
        updatedAt: now,
        createdAt: existing ? existing.createdAt : now
      });

      await ESS.Data.put(S.claims, claim);

      await ESS.Audit.log({
        module: 'Expense',
        action: existing ? 'Expense Claim Draft Updated' : 'Expense Claim Draft Saved',
        recordId: claimId,
        employeeCode: empCode,
        note: `${claim.title} (${ESS.inr(claim.amount)})`
      });

      return claim;
    },

    /**
     * Submits an expense claim for approval.
     */
    async submit(claimId) {
      const actor = ESS.Auth.actor();
      ESS.require(actor, 'Not signed in', 'auth');

      let claim = await ESS.Data.get(S.claims, claimId);
      ESS.require(claim, 'Claim not found.', 'notfound');
      ESS.Auth.requireSelfOrHR(claim.EmployeeCode);
      ESS.require(['Draft', 'Returned for Correction'].includes(claim.status), 'Only drafts or returned claims can be submitted.', 'state');

      // Check receipt requirement
      const cfg = ESS.Settings.get().expense;
      const catObj = (cfg.categories || []).find(c => c.name.toLowerCase() === claim.category.toLowerCase());
      if (catObj && catObj.receiptAbove != null && claim.amount >= catObj.receiptAbove) {
        if (!claim.receiptIds || claim.receiptIds.length === 0) {
          throw new ESS.Error(`A receipt is required for ${claim.category} expenses of ${ESS.inr(catObj.receiptAbove)} or more.`, 'receipt_required');
        }
      }

      const now = new Date().toISOString();
      const emp = ESS.Org.get(claim.EmployeeCode);

      // Start workflow
      claim = ESS.Flow.start('expense', claim, 'Expense Claim Submitted');

      const ops = [{ op: 'put', store: S.claims, value: claim }];

      // Notify approver
      const curStage = ESS.Flow.currentStage(claim);
      if (curStage) {
        ESS.Flow.recipientsFor(curStage).forEach(to => {
          ops.push({
            op: 'put',
            store: S.notifications,
            value: {
              id: ESS.uid('NT'),
              RecipientCode: to,
              type: 'info',
              title: `Expense Claim from ${emp ? emp.EmployeeName : claim.EmployeeCode}`,
              body: `${claim.title} (${ESS.inr(claim.amount)}) awaiting your review.`,
              link: { page: 'approvals', id: claimId },
              createdAt: now,
              readAt: null
            }
          });
        });
      }

      await ESS.Data.batch(ops);

      await ESS.Audit.log({
        module: 'Expense',
        action: 'Expense Claim Submitted',
        recordId: claimId,
        employeeCode: claim.EmployeeCode,
        note: `${claim.title} for ${ESS.inr(claim.amount)} (${claim.category})`
      });

      // Prepare email draft
      const tpl = ESS.Email.templates.expenseSubmitted(claim, emp || { EmployeeName: claim.EmployeeCode }, curStage ? ESS.Flow.stageLabel(curStage) : 'Sir/Madam');
      const emailBase = {
        requestId: claimId,
        kind: 'expense',
        employeeCode: claim.EmployeeCode,
        purpose: 'Expense claim approval notice',
        to: curStage && curStage.approverCode ? ESS.Email.addressOf(curStage.approverCode) : (ESS.Settings.get().email.financeEmail || ''),
        subject: tpl.subject,
        body: tpl.body
      };
      const emailDraft = ESS.Remote ? await ESS.Remote.registerDraft('expense', claim, emp, emailBase) : await ESS.Email.create(emailBase);

      return { claim, emailDraft };
    },

    /**
     * Mark an approved expense claim as reimbursed (Finance action).
     */
    async markReimbursed(claimId, paymentRef, remarks) {
      ESS.Auth.require('approve.finance');
      const actor = ESS.Auth.actor();

      const claim = await ESS.Data.get(S.claims, claimId);
      ESS.require(claim, 'Claim not found.', 'notfound');
      ESS.require(claim.status === 'Approved', 'Only approved claims can be marked as reimbursed.', 'state');
      ESS.require((paymentRef || '').trim(), 'Payment reference / transaction ID is required.');

      const now = new Date().toISOString();
      const before = claim.status;
      claim.status = 'Reimbursed';
      claim.reimbursedAt = now;
      claim.reimbursementRef = paymentRef.trim();
      claim.reimbursementRemarks = (remarks || '').trim();
      claim.updatedAt = now;

      claim.timeline = claim.timeline || [];
      claim.timeline.push({
        at: now,
        actor: actor.name,
        actorCode: actor.code,
        action: 'Reimbursed',
        status: 'Reimbursed',
        remarks: `Ref: ${paymentRef}${remarks ? ' · ' + remarks : ''}`
      });

      const note = {
        to: claim.EmployeeCode,
        type: 'success',
        title: `Expense Claim ${claim.id} Reimbursed`,
        body: `Payment of ${ESS.inr(claim.amount)} processed (Ref: ${paymentRef}).`,
        link: { page: 'expenses', id: claim.id }
      };

      await ESS.Data.batch([
        { op: 'put', store: S.claims, value: claim },
        ...ESS.Notify.buildOps([note])
      ]);

      await ESS.Audit.log({
        module: 'Expense',
        action: 'Expense Claim Reimbursed',
        recordId: claim.id,
        employeeCode: claim.EmployeeCode,
        changes: { status: [before, 'Reimbursed'], paymentRef },
        note: `Payment reference: ${paymentRef}`
      });

      return claim;
    },

    /**
     * Deletes a draft claim.
     */
    async deleteDraft(claimId) {
      const actor = ESS.Auth.actor();
      const claim = await ESS.Data.get(S.claims, claimId);
      ESS.require(claim, 'Claim not found.', 'notfound');
      ESS.Auth.requireSelfOrHR(claim.EmployeeCode);
      ESS.require(claim.status === 'Draft', 'Only claims in Draft status can be deleted.', 'state');

      await ESS.Data.del(S.claims, claimId);
      await ESS.Audit.log({
        module: 'Expense',
        action: 'Expense Claim Draft Deleted',
        recordId: claimId,
        employeeCode: claim.EmployeeCode,
        note: `Deleted draft: ${claim.title}`
      });
    },

    /**
     * Gets all claims for an employee.
     */
    async getEmployeeClaims(empCode) {
      const claims = await ESS.Data.byIndex(S.claims, 'EmployeeCode', empCode);
      claims.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return claims;
    },

    /**
     * Aggregates employee expense metrics.
     */
    async getMetrics(empCode) {
      const claims = await this.getEmployeeClaims(empCode);
      let submitted = 0;
      let pending = 0;
      let approved = 0;
      let rejected = 0;
      let reimbursed = 0;

      claims.forEach(c => {
        const amt = Number(c.amount) || 0;
        if (c.status !== 'Draft' && c.status !== 'Cancelled') {
          submitted += amt;
        }
        if (ESS.Flow.isPending(c.status)) {
          pending += amt;
        } else if (c.status === 'Approved') {
          approved += amt;
        } else if (c.status === 'Rejected') {
          rejected += amt;
        } else if (c.status === 'Reimbursed') {
          reimbursed += amt;
        }
      });

      return {
        submitted,
        pending,
        approved,
        rejected,
        reimbursed,
        totalClaimsCount: claims.length
      };
    }
  };
})(window);
