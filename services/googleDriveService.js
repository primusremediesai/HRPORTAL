const { google } = require('googleapis');
const stream = require('stream');
const fs = require('fs');
const path = require('path');

class GoogleDriveService {
  constructor() {
    this.driveClient = null;
    this.rootFolderId = null;
    this.categoryFolders = {};
  }

  isConfigured() {
    const hasOAuth = !!(
      process.env.GOOGLE_DRIVE_CLIENT_ID &&
      process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
      process.env.GOOGLE_DRIVE_REFRESH_TOKEN
    );
    const hasServiceAccount = !!(
      (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) ||
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
      (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) ||
      fs.existsSync(path.resolve(__dirname, '..', 'service-account.json'))
    );
    return hasOAuth || hasServiceAccount;
  }

  getAuthMode() {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) return 'service_account';
    if (fs.existsSync(path.resolve(__dirname, '..', 'service-account.json'))) return 'service_account';
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)) return 'service_account';
    if (process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET && process.env.GOOGLE_DRIVE_REFRESH_TOKEN) return 'oauth2';
    return 'none';
  }

  getClient() {
    if (this.driveClient) return this.driveClient;
    if (!this.isConfigured()) return null;

    const mode = this.getAuthMode();

    if (mode === 'service_account') {
      let auth;
      const localSaPath = path.resolve(__dirname, '..', 'service-account.json');
      const credsPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS))
        ? process.env.GOOGLE_APPLICATION_CREDENTIALS
        : fs.existsSync(localSaPath) ? localSaPath : null;

      if (credsPath) {
        auth = new google.auth.GoogleAuth({
          keyFile: credsPath,
          scopes: ['https://www.googleapis.com/auth/drive']
        });
      } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        try {
          const keyData = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
          auth = new google.auth.JWT({
            email: keyData.client_email,
            key: keyData.private_key,
            scopes: ['https://www.googleapis.com/auth/drive']
          });
        } catch (e) {
          console.error('[GoogleDrive] Error parsing GOOGLE_SERVICE_ACCOUNT_KEY:', e.message);
        }
      } else if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
        auth = new google.auth.JWT({
          email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
          scopes: ['https://www.googleapis.com/auth/drive']
        });
      }

      if (auth) {
        this.driveClient = google.drive({ version: 'v3', auth });
        return this.driveClient;
      }
    }

    if (mode === 'oauth2') {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_DRIVE_CLIENT_ID,
        process.env.GOOGLE_DRIVE_CLIENT_SECRET,
        process.env.GOOGLE_DRIVE_REDIRECT_URI || 'http://localhost:3000/api/files/oauth2callback'
      );

      oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN
      });

      this.driveClient = google.drive({ version: 'v3', auth: oauth2Client });
      return this.driveClient;
    }

    return null;
  }

  /**
   * Ensure root application sandbox folder exists in Google Drive
   */
  async getOrCreateRootFolder() {
    if (this.rootFolderId) return this.rootFolderId;

    const drive = this.getClient();
    if (!drive) throw new Error('Google Drive is not configured in .env');

    const rootFolderName = process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME || 'HRPortal_App_Storage';

    // Check if root folder already exists
    const res = await drive.files.list({
      q: `name = '${rootFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (res.data.files && res.data.files.length > 0) {
      this.rootFolderId = res.data.files[0].id;
      return this.rootFolderId;
    }

    // Create root folder
    const fileMetadata = {
      name: rootFolderName,
      mimeType: 'application/vnd.google-apps.folder'
    };

    const folder = await drive.files.create({
      resource: fileMetadata,
      fields: 'id'
    });

    this.rootFolderId = folder.data.id;
    return this.rootFolderId;
  }

  /**
   * Get or create category subfolder (e.g., onboarding, payroll, policies)
   */
  async getOrCreateCategoryFolder(categoryName) {
    if (this.categoryFolders[categoryName]) {
      return this.categoryFolders[categoryName];
    }

    const drive = this.getClient();
    const parentId = await this.getOrCreateRootFolder();

    const folderDisplayNames = {
      onboarding: 'Onboarding_Documents',
      employee_record: 'Employee_Records',
      payroll: 'Payroll_Slips',
      policy: 'Company_Policies',
      hr_vault: 'HR_Vault',
      general: 'General_Files'
    };

    const targetName = folderDisplayNames[categoryName] || 'General_Files';

    const res = await drive.files.list({
      q: `name = '${targetName}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (res.data.files && res.data.files.length > 0) {
      this.categoryFolders[categoryName] = res.data.files[0].id;
      return this.categoryFolders[categoryName];
    }

    const folderMetadata = {
      name: targetName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    };

    const folder = await drive.files.create({
      resource: folderMetadata,
      fields: 'id'
    });

    this.categoryFolders[categoryName] = folder.data.id;
    return this.categoryFolders[categoryName];
  }

  /**
   * Upload buffer directly to Google Drive under discriminated folder
   */
  async uploadFile({ buffer, originalName, mimeType, category }) {
    const drive = this.getClient();
    if (!drive) throw new Error('Google Drive client is not initialized');

    const folderId = await this.getOrCreateCategoryFolder(category);

    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);

    const fileMetadata = {
      name: originalName,
      parents: [folderId]
    };

    const media = {
      mimeType: mimeType,
      body: bufferStream
    };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, webContentLink, size'
    });

    return {
      fileId: file.data.id,
      webViewLink: file.data.webViewLink,
      webContentLink: file.data.webContentLink
    };
  }

  /**
   * Download / stream file from Google Drive
   */
  async getFileStream(fileId) {
    const drive = this.getClient();
    if (!drive) throw new Error('Google Drive client is not initialized');

    return await drive.files.get(
      { fileId: fileId, alt: 'media' },
      { responseType: 'stream' }
    );
  }

  /**
   * Delete file from Google Drive
   */
  async deleteFile(fileId) {
    const drive = this.getClient();
    if (!drive) return;
    await drive.files.delete({ fileId: fileId });
  }
}

module.exports = new GoogleDriveService();
