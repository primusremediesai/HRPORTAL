const mongoose = require('mongoose');

/**
 * One-time approval link token. Only the SHA-256 hash is stored, so a database leak
 * does not expose usable links. Tokens expire 24 hours after issue and are single-use.
 */
const approvalTokenSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, index: true },
  requestId: { type: String, required: true, index: true },
  stageIndex: { type: Number, required: true },
  approverEmail: { type: String, default: '' },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ['active', 'used', 'revoked'], default: 'active' },
  usedAt: { type: Date },
  usedFromIp: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('ApprovalToken', approvalTokenSchema);
