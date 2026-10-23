/* ==========================================================================
   PRIMUS REMEDIES — ESS — SECURE HR DOCUMENT VAULT
   Role-segregated document repository • Strict employee privacy •
   Categories: Payslips, Offer Letter, Appointment Letter, Employment Agreement,
   Confirmation Letter, Promotion Letter, Salary Revision Letter, Tax Documents,
   Form 16, Experience Letter, Relieving Letter, Other HR Documents.
   Secure preview • Audit logging of all access.
   ========================================================================== */
(function (global) {
  'use strict';
  const ESS = (global.ESS = global.ESS || {});
  const S = ESS.S;

  ESS.Documents = {
    CATEGORIES: [
      'Payslips',
      'Offer Letter',
      'Onboarding Documents',
      'Appointment Letter',
      'Employment Agreement',
      'Confirmation Letter',
      'Promotion Letter',
      'Salary Revision Letter',
      'Tax Documents',
      'Form 16',
      'Experience Letter',
      'Relieving Letter',
      'Other HR Documents'
    ],

    /**
     * Uploads or publishes an HR document for an employee.
     * Accessible only by HR Administrators.
     */
    async upload({ empCode, title, category, financialYear, file, remarks }) {
      ESS.Auth.require('admin.documents');
      const actor = ESS.Auth.actor();

      ESS.require(empCode, 'Employee code is required.');
      const emp = ESS.Org.get(empCode);
      ESS.require(emp, `Employee ${empCode} not found in employee master.`);

      ESS.require(this.CATEGORIES.includes(category), `Invalid category. Must be one of: ${this.CATEGORIES.join(', ')}`);
      ESS.require((title || '').trim().length >= 3, 'Document title must be at least 3 characters.');
      ESS.require(file, 'Please select a document file.');

      const maxMB = (ESS.Settings.get().documents || {}).maxFileMB || 10;
      if (file.size > maxMB * 1024 * 1024) {
        throw new ESS.Error(`File size exceeds limit of ${maxMB} MB.`, 'file_too_large');
      }

      const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
      if (!validTypes.includes(file.type)) {
        throw new ESS.Error('Unsupported file type. Accepted formats: PDF, JPG, PNG, DOC, DOCX, TXT.', 'invalid_file_type');
      }

      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read document file.'));
        reader.readAsDataURL(file);
      });

      const docId = ESS.uid('DOC');
      const fileId = ESS.uid('FIL');
      const now = new Date().toISOString();

      const fileRecord = {
        id: fileId,
        ownerCode: empCode,
        name: file.name,
        size: file.size,
        type: file.type,
        data: fileData,
        uploadedAt: now
      };

      const docRecord = {
        id: docId,
        EmployeeCode: empCode,
        employeeName: emp.EmployeeName,
        title: title.trim(),
        category: category,
        financialYear: financialYear || null,
        fileId: fileId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        status: 'Active', // Active | Revoked
        uploadedBy: actor.code,
        uploadedByName: actor.name,
        remarks: (remarks || '').trim(),
        createdAt: now,
        updatedAt: now
      };

      await ESS.Data.batch([
        { op: 'put', store: S.files, value: fileRecord },
        { op: 'put', store: S.documents, value: docRecord },
        ...ESS.Notify.buildOps([{
          to: empCode,
          type: 'info',
          title: `New HR Document Available: ${docRecord.title}`,
          body: `A new document (${category}) has been uploaded to your Document Vault.`,
          link: { page: 'documents', id: docId }
        }])
      ]);

      await ESS.Audit.log({
        module: 'Document Vault',
        action: 'Document Uploaded',
        recordId: docId,
        employeeCode: empCode,
        note: `${category}: ${docRecord.title} (${file.name})`
      });

      return docRecord;
    },

    /**
     * Gets documents accessible to the given employee.
     * Enforces privacy: non-HR employees can only view their own active documents.
     */
    async getEmployeeDocuments(empCode) {
      ESS.Auth.requireSelfOrHR(empCode);
      const actor = ESS.Auth.actor();
      // Documents HR uploaded from the admin UI live on the server — mirror them into this vault
      if (actor && actor.code === empCode) { try { await this.syncFromServer(empCode); } catch (e) { console.warn('[ESS] vault sync failed', e); } }
      const all = await ESS.Data.byIndex(S.documents, 'EmployeeCode', empCode);
      const isHR = ESS.Auth.can('admin.documents');

      // Filter out revoked documents for regular employees
      const filtered = isHR ? all : all.filter(d => d.status === 'Active');
      filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return filtered;
    },

    /**
     * Mirrors this employee's HR-published documents (uploaded in the admin UI) into the vault.
     * Revoked / deleted server documents are hidden here as well. Idempotent.
     */
    async syncFromServer(empCode) {
      let resp;
      try { resp = await fetch('/api/hr-docs/mine', { credentials: 'same-origin' }); } catch (e) { return 0; }
      if (!resp.ok) return 0;
      const { documents } = await resp.json();
      const local = (await ESS.Data.byIndex(S.documents, 'EmployeeCode', empCode)).filter(d => d.remote);
      const have = new Map(local.map(d => [d.id, d]));
      const live = new Set();
      const ops = []; const notes = [];
      (documents || []).forEach(sd => {
        const id = 'SRV-' + sd.id; live.add(id);
        const cur = have.get(id);
        if (cur && cur.status === 'Active') return;
        ops.push({ op: 'put', store: S.documents, value: {
          id, remote: true, serverId: sd.id, EmployeeCode: empCode, employeeName: sd.employeeName || '', title: sd.title, category: sd.category,
          financialYear: sd.period || null, fileId: null, fileName: sd.fileName, fileSize: sd.fileSize, fileType: sd.fileType, status: 'Active',
          uploadedBy: sd.uploaderEmail || 'HR', uploadedByName: 'HR', remarks: sd.remarks || '', createdAt: sd.createdAt, updatedAt: sd.updatedAt
        } });
        if (!cur) notes.push({ to: empCode, type: 'info', title: `New HR Document Available: ${sd.title}`, body: `${sd.category} has been added to your Document Vault by HR.`, link: { page: 'documents', id } });
      });
      local.forEach(d => { if (d.status === 'Active' && !live.has(d.id)) ops.push({ op: 'put', store: S.documents, value: Object.assign({}, d, { status: 'Revoked', updatedAt: new Date().toISOString() }) }); });
      if (ops.length || notes.length) await ESS.Data.batch([...ops, ...ESS.Notify.buildOps(notes)]);
      return ops.length;
    },

    /** Fetches server-held file content (session-authenticated) as a data URL for preview/download. */
    async _fetchRemoteFile(doc) {
      const resp = await fetch(`/api/hr-docs/${encodeURIComponent(doc.serverId)}/download`, { credentials: 'same-origin' });
      if (!resp.ok) throw new ESS.Error(resp.status === 403 ? 'You are not authorised to open this document.' : 'Could not retrieve this document from the server.', 'file_missing');
      const blob = await resp.blob();
      const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Failed to read document')); r.readAsDataURL(blob); });
      return { id: doc.id, ownerCode: doc.EmployeeCode, name: doc.fileName, size: doc.fileSize || blob.size, type: doc.fileType || blob.type, data };
    },

    /**
     * Securely fetches document and its file data for preview or download.
     */
    async fetchDocumentWithData(docId) {
      const doc = await ESS.Data.get(S.documents, docId);
      ESS.require(doc, 'Document not found.', 'notfound');
      ESS.Auth.requireSelfOrHR(doc.EmployeeCode);

      if (doc.status === 'Revoked' && !ESS.Auth.can('admin.documents')) {
        throw new ESS.Error('Access to this document has been revoked by HR.', 'revoked');
      }

      const file = doc.remote ? await this._fetchRemoteFile(doc) : await ESS.Data.get(S.files, doc.fileId);
      ESS.require(file, 'Document content is unavailable.', 'file_missing');

      // Log audit access
      await ESS.Audit.log({
        module: 'Document Vault',
        action: 'Document Accessed / Previewed',
        recordId: docId,
        employeeCode: doc.EmployeeCode,
        note: `Accessed: ${doc.title} (${doc.category})`
      });

      return { doc, file };
    },

    /**
     * Revoke document access. Accessible only by HR.
     */
    async revoke(docId, reason) {
      ESS.Auth.require('admin.documents');
      const actor = ESS.Auth.actor();

      const doc = await ESS.Data.get(S.documents, docId);
      ESS.require(doc, 'Document not found.', 'notfound');

      const before = doc.status;
      doc.status = 'Revoked';
      doc.revokedAt = new Date().toISOString();
      doc.revokedBy = actor.code;
      doc.revokeReason = (reason || '').trim();
      doc.updatedAt = new Date().toISOString();

      await ESS.Data.put(S.documents, doc);

      await ESS.Audit.log({
        module: 'Document Vault',
        action: 'Document Revoked',
        recordId: docId,
        employeeCode: doc.EmployeeCode,
        changes: { status: [before, 'Revoked'], reason: doc.revokeReason },
        note: `Revoked ${doc.title}: ${reason}`
      });

      return doc;
    }
  };
})(window);
