const mongoose = require('mongoose');

/** HR-published document for a specific employee (shown in that employee's ESS "Document Vault"). */
const employeeDocumentSchema = new mongoose.Schema({
  employeeCode: { type: String, required: true, index: true, uppercase: true, trim: true },
  employeeName: { type: String, default: '' },
  title: { type: String, required: true, trim: true },
  category: { type: String, required: true }, // one of ESS.Documents.CATEGORIES
  period: { type: String, default: '' },       // e.g. "Oct 2026" for payslips or "FY 2025-26" for Form 16
  remarks: { type: String, default: '' },

  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  sizeBytes: { type: Number, required: true },

  storageType: { type: String, enum: ['google_drive', 'local'], default: 'local' },
  driveFileId: String,
  driveWebViewLink: String,
  localFilePath: String,

  status: { type: String, enum: ['Active', 'Revoked'], default: 'Active', index: true },
  revokedAt: Date,
  revokeReason: String,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploaderEmail: String
}, { timestamps: true });

module.exports = mongoose.model('EmployeeDocument', employeeDocumentSchema);
