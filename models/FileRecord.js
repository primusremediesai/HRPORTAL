const mongoose = require('mongoose');

const fileRecordSchema = new mongoose.Schema({
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  
  // Categorization & Discrimination
  category: { 
    type: String, 
    enum: ['onboarding', 'employee_record', 'payroll', 'policy', 'general'], 
    default: 'general' 
  },
  employeeCode: { type: String, index: true }, // Optional association with an employee
  department: { type: String, index: true },
  
  // Storage Location
  storageType: { 
    type: String, 
    enum: ['google_drive', 'local'], 
    default: 'local' 
  },
  driveFileId: { type: String }, // Google Drive ID when uploaded to cloud
  driveWebViewLink: { type: String }, // Direct link to open in Google Drive
  localFilePath: { type: String }, // Path if stored locally in uploads/
  
  // Access Control & Uploader
  uploadedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  uploaderEmail: { type: String },
  accessLevel: { 
    type: String, 
    enum: ['admin_hr_only', 'employee_private', 'public_company'], 
    default: 'admin_hr_only' 
  }
}, { timestamps: true });

module.exports = mongoose.model('FileRecord', fileRecordSchema);
