const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const upload = require('../middleware/uploadMiddleware');
const googleDriveService = require('../services/googleDriveService');
const EmployeeDocument = require('../models/EmployeeDocument');
const AuditLog = require('../models/AuditLog');

const CATEGORIES = ['Payslips', 'Offer Letter', 'Appointment Letter', 'Employment Agreement', 'Confirmation Letter', 'Promotion Letter',
  'Salary Revision Letter', 'Tax Documents', 'Form 16', 'Experience Letter', 'Relieving Letter', 'Onboarding Documents', 'Other HR Documents'];
const LOCAL_DIR = path.resolve(__dirname, '..', process.env.LOCAL_UPLOAD_DIR || './uploads', 'hr-docs');
const isHR = (req) => ['admin', 'hr_manager'].includes(req.session && req.session.role);
const myCode = (req) => String((req.session && req.session.employeeCode) || '').toUpperCase();
const requireHR = (req, res, next) => isHR(req) ? next() : res.status(403).json({ error: 'Only HR / administrators can manage employee documents' });
const safe = (d) => ({
  id: d._id, employeeCode: d.employeeCode, employeeName: d.employeeName, title: d.title, category: d.category, period: d.period,
  remarks: d.remarks, fileName: d.originalName, fileType: d.mimeType, fileSize: d.sizeBytes, status: d.status,
  uploaderEmail: d.uploaderEmail, storageType: d.storageType, createdAt: d.createdAt, updatedAt: d.updatedAt
});

// Employee: only their own active documents
router.get('/mine', async (req, res) => {
  const code = myCode(req);
  if (!code) return res.json({ documents: [] });
  const docs = await EmployeeDocument.find({ employeeCode: code, status: 'Active' }).sort({ createdAt: -1 });
  res.json({ documents: docs.map(safe) });
});

// HR: documents of one employee (used by the employee profile "Documents" tab)
router.get('/employee/:code', requireHR, async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const docs = await EmployeeDocument.find({ employeeCode: code }).sort({ createdAt: -1 });
  res.json({ documents: docs.map(safe), categories: CATEGORIES });
});

// HR: upload for an employee
router.post('/upload', requireHR, (req, res, next) => upload.single('file')(req, res, (err) => err ? res.status(400).json({ error: err.message }) : next()), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please choose a file to upload' });
    const code = String(req.body.employeeCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return res.status(400).json({ error: 'A valid employee code is required' });
    const category = String(req.body.category || '');
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid document category' });
    const title = String(req.body.title || '').trim().slice(0, 160);
    if (title.length < 3) return res.status(400).json({ error: 'Document title must be at least 3 characters' });

    const rec = {
      employeeCode: code, employeeName: String(req.body.employeeName || '').slice(0, 120), title, category,
      period: String(req.body.period || '').trim().slice(0, 40), remarks: String(req.body.remarks || '').trim().slice(0, 500),
      originalName: req.file.originalname, mimeType: req.file.mimetype, sizeBytes: req.file.size,
      uploadedBy: req.session.userId, uploaderEmail: req.session.email
    };

    let driveCategory = 'employee_record';
    if (category === 'Onboarding Documents') driveCategory = 'onboarding';
    else if (['Payslips', 'Tax Documents', 'Form 16'].includes(category)) driveCategory = 'payroll';
    else if (['Offer Letter', 'Appointment Letter', 'Employment Agreement', 'Confirmation Letter', 'Promotion Letter', 'Salary Revision Letter', 'Experience Letter', 'Relieving Letter'].includes(category)) driveCategory = 'employee_record';
    else driveCategory = 'hr_vault';

    if (googleDriveService.isConfigured()) {
      const d = await googleDriveService.uploadFile({ buffer: req.file.buffer, originalName: req.file.originalname, mimeType: req.file.mimetype, category: driveCategory });
      Object.assign(rec, { storageType: 'google_drive', driveFileId: d.fileId, driveWebViewLink: d.webViewLink });
    } else {
      fs.mkdirSync(LOCAL_DIR, { recursive: true });
      const ext = (path.extname(req.file.originalname) || '').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 8);
      const file = path.join(LOCAL_DIR, `${code}-${crypto.randomBytes(12).toString('hex')}${ext}`);
      fs.writeFileSync(file, req.file.buffer);
      Object.assign(rec, { storageType: 'local', localFilePath: file });
    }
    const doc = await EmployeeDocument.create(rec);
    await AuditLog.create({ action: 'EMPLOYEE_DOC_UPLOAD', userId: req.session.userId, ip: req.ip, details: `${category} "${title}" for ${code} (${doc.storageType})` });
    res.status(201).json({ success: true, document: safe(doc) });
  } catch (e) {
    console.error('HR doc upload error:', e);
    res.status(500).json({ error: e.message || 'Upload failed' });
  }
});

// Download / preview: HR any; employee only their own active documents
router.get('/:id/download', async (req, res) => {
  try {
    const d = await EmployeeDocument.findById(req.params.id);
    if (!d) return res.status(404).json({ error: 'Document not found' });
    if (!isHR(req) && (d.employeeCode !== myCode(req) || d.status !== 'Active')) return res.status(403).json({ error: 'Not authorised to access this document' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', d.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.originalName)}"`);
    if (d.storageType === 'google_drive') {
      const s = await googleDriveService.getFileStream(d.driveFileId);
      return s.data.pipe(res);
    }
    if (!d.localFilePath || !fs.existsSync(d.localFilePath)) return res.status(404).json({ error: 'File is missing on the server' });
    fs.createReadStream(d.localFilePath).pipe(res);
  } catch (e) {
    console.error('HR doc download error:', e);
    res.status(500).json({ error: 'Download failed' });
  }
});

// HR: withdraw from the employee's vault (kept for audit) or delete permanently
router.post('/:id/revoke', requireHR, async (req, res) => {
  const d = await EmployeeDocument.findById(req.params.id);
  if (!d) return res.status(404).json({ error: 'Document not found' });
  d.status = 'Revoked'; d.revokedAt = new Date(); d.revokeReason = String((req.body || {}).reason || '').slice(0, 300);
  await d.save();
  await AuditLog.create({ action: 'EMPLOYEE_DOC_REVOKE', userId: req.session.userId, ip: req.ip, details: `Revoked "${d.title}" for ${d.employeeCode}` });
  res.json({ success: true, document: safe(d) });
});
router.delete('/:id', requireHR, async (req, res) => {
  const d = await EmployeeDocument.findById(req.params.id);
  if (!d) return res.status(404).json({ error: 'Document not found' });
  try {
    if (d.storageType === 'google_drive' && d.driveFileId) await googleDriveService.deleteFile(d.driveFileId);
    else if (d.localFilePath && fs.existsSync(d.localFilePath)) fs.unlinkSync(d.localFilePath);
  } catch (e) { console.error('HR doc storage delete failed:', e.message); }
  await EmployeeDocument.findByIdAndDelete(d._id);
  await AuditLog.create({ action: 'EMPLOYEE_DOC_DELETE', userId: req.session.userId, ip: req.ip, details: `Deleted "${d.title}" for ${d.employeeCode}` });
  res.json({ success: true });
});

module.exports = router;
