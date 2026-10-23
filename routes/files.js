const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const upload = require('../middleware/uploadMiddleware');
const googleDriveService = require('../services/googleDriveService');
const FileRecord = require('../models/FileRecord');
const AuditLog = require('../models/AuditLog');

// Ensure local uploads directory exists
const LOCAL_DIR = path.resolve(__dirname, '..', process.env.LOCAL_UPLOAD_DIR || './uploads');
if (!fs.existsSync(LOCAL_DIR)) {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

/**
 * GET /api/files
 * List files with granular discrimination (category, employeeCode, role permissions)
 */
router.get('/', async (req, res) => {
  try {
    const { category, employeeCode } = req.query;
    const filter = {};

    // Category filter
    if (category) filter.category = category;

    // Role-based discrimination
    if (req.session.role === 'employee') {
      // Employees can only view their own files or public company files
      filter.$or = [
        { uploadedBy: req.session.userId },
        { employeeCode: req.user?.employeeCode },
        { accessLevel: 'public_company' }
      ];
    } else {
      // Admins and HR Managers can view all or filter by specific employee
      if (employeeCode) filter.employeeCode = employeeCode;
    }

    const files = await FileRecord.find(filter)
      .sort({ createdAt: -1 })
      .limit(100);

    const storageStatus = {
      isGoogleDriveActive: googleDriveService.isConfigured(),
      targetQuota: '5 TB Google Cloud / Drive Storage'
    };

    res.json({ files, storageStatus });
  } catch (err) {
    console.error('List files error:', err);
    res.status(500).json({ error: 'Failed to retrieve files' });
  }
});

/**
 * POST /api/files/upload
 * Upload document and save to Google Drive (or local staging if Drive not yet linked)
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { category = 'general', employeeCode = '', accessLevel = 'admin_hr_only' } = req.body;
    const isDriveActive = googleDriveService.isConfigured();

    let recordData = {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      category: category,
      employeeCode: employeeCode,
      uploadedBy: req.session.userId,
      uploaderEmail: req.user?.email || 'admin@primus.local',
      accessLevel: accessLevel
    };

    if (isDriveActive) {
      // Upload directly to discriminated folder in Google Drive (5 TB quota)
      const driveRes = await googleDriveService.uploadFile({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        category: category
      });

      recordData.storageType = 'google_drive';
      recordData.driveFileId = driveRes.fileId;
      recordData.driveWebViewLink = driveRes.webViewLink;
    } else {
      // Local fallback staging
      const safeFilename = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const savePath = path.join(LOCAL_DIR, safeFilename);
      fs.writeFileSync(savePath, req.file.buffer);

      recordData.storageType = 'local';
      recordData.localFilePath = savePath;
    }

    const fileRecord = await FileRecord.create(recordData);

    await AuditLog.create({
      action: 'FILE_UPLOAD',
      userId: req.session.userId,
      ip: req.ip,
      details: `Uploaded ${req.file.originalname} (${recordData.storageType})`
    });

    res.status(201).json({
      success: true,
      message: isDriveActive 
        ? 'File successfully uploaded to Google Drive' 
        : 'File saved to local storage (Google Drive setup pending)',
      file: fileRecord
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'File upload failed' });
  }
});

/**
 * GET /api/files/:id/download
 * Download or stream the file
 */
router.get('/:id/download', async (req, res) => {
  try {
    const file = await FileRecord.findById(req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });

    // Role check
    if (req.session.role === 'employee' && 
        file.accessLevel !== 'public_company' && 
        file.uploadedBy.toString() !== req.session.userId) {
      return res.status(403).json({ error: 'Unauthorized to access this file' });
    }

    if (file.storageType === 'google_drive') {
      const driveStream = await googleDriveService.getFileStream(file.driveFileId);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
      driveStream.data.pipe(res);
    } else {
      if (!fs.existsSync(file.localFilePath)) {
        return res.status(404).json({ error: 'Local file is missing on server' });
      }
      res.download(file.localFilePath, file.originalName);
    }
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

/**
 * DELETE /api/files/:id
 * Delete a file record and cloud object
 */
router.delete('/:id', async (req, res) => {
  try {
    // Only Admin or HR Manager can delete files
    if (req.session.role !== 'admin' && req.session.role !== 'hr_manager') {
      return res.status(403).json({ error: 'Only administrators can delete files' });
    }

    const file = await FileRecord.findById(req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });

    if (file.storageType === 'google_drive' && file.driveFileId) {
      await googleDriveService.deleteFile(file.driveFileId);
    } else if (file.localFilePath && fs.existsSync(file.localFilePath)) {
      fs.unlinkSync(file.localFilePath);
    }

    await FileRecord.findByIdAndDelete(req.params.id);

    await AuditLog.create({
      action: 'FILE_DELETE',
      userId: req.session.userId,
      ip: req.ip,
      details: `Deleted file ${file.originalName}`
    });

    res.json({ success: true, message: 'File deleted successfully' });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

module.exports = router;
