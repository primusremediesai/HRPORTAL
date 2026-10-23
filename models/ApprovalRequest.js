const mongoose = require('mongoose');

/**
 * Server-side record of an ESS request (leave / expense / attendance correction) that is
 * approved through secure, expiring e-mail links. The ESS browser store remains the
 * employee's working copy; decisions made through links are recorded here and synced
 * into the employee's ESS (see routes/essApprovals.js -> GET /sync).
 */
const stageSchema = new mongoose.Schema({
  role: { type: String, enum: ['manager', 'hr', 'finance'], required: true },
  approverCode: { type: String, default: '' },
  approverName: { type: String, default: '' },
  approverEmail: { type: String, default: '' },
  state: { type: String, enum: ['pending', 'approved', 'rejected', 'returned', 'skipped'], default: 'pending' },
  actorEmail: { type: String, default: '' },
  actorName: { type: String, default: '' },
  remarks: { type: String, default: '' },
  at: { type: Date },
  via: { type: String, default: '' } // 'email-link' | 'ess-portal'
}, { _id: false });

const decisionSchema = new mongoose.Schema({
  seq: { type: Number, required: true },
  stageIndex: { type: Number, required: true },
  role: String,
  action: { type: String, enum: ['approve', 'reject', 'return'] },
  actorEmail: String,
  actorName: String,
  remarks: String,
  at: Date,
  via: String,
  applied: { type: Boolean, default: false } // true once synced into the employee's ESS
}, { _id: false });

const approvalRequestSchema = new mongoose.Schema({
  requestId: { type: String, required: true, unique: true, index: true },
  kind: { type: String, enum: ['leave', 'expense', 'correction'], required: true },
  employeeCode: { type: String, required: true, index: true },
  employeeName: { type: String, default: '' },
  employeeEmail: { type: String, default: '' },
  title: { type: String, default: '' },
  lines: [{ _id: false, label: String, value: String }], // display snapshot shown on the approval page
  stages: [stageSchema],
  currentStage: { type: Number, default: null },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Returned', 'Cancelled'], default: 'Pending', index: true },
  decisions: [decisionSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('ApprovalRequest', approvalRequestSchema);
