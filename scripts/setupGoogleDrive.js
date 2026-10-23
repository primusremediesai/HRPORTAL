/**
 * Setup & Test Script for 5 TB Google Drive Integration
 * 
 * Instructions:
 * 1. Go to Google Cloud Console (https://console.cloud.google.com)
 * 2. Enable "Google Drive API"
 * 3. Create OAuth 2.0 Credentials (Web application or Desktop application)
 *    - Add Redirect URI: http://localhost:3000/api/files/oauth2callback
 * 4. Fill GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in .env
 * 5. Run this script: node scripts/setupGoogleDrive.js
 */

require('dotenv').config();
const { google } = require('googleapis');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const googleDriveService = require('../services/googleDriveService');

const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI || 'http://localhost:3000/api/files/oauth2callback';

async function main() {
  if (process.argv.includes('--test') || process.argv.includes('-t')) {
    console.log('========================================================================');
    console.log(' TESTING 5 TB GOOGLE DRIVE STORAGE CONNECTION');
    console.log('========================================================================');
    if (!googleDriveService.isConfigured()) {
      console.log('❌ Google Drive is not yet configured in .env');
      console.log('To configure, you can use:');
      console.log('  Option 1: OAuth2 credentials (GOOGLE_DRIVE_CLIENT_ID, SECRET & REFRESH_TOKEN)');
      console.log('  Option 2: Google Cloud Service Account (place service-account.json in root)');
      console.log('========================================================================');
      return;
    }
    const mode = googleDriveService.getAuthMode();
    console.log(`Detected Authentication Mode: ${mode.toUpperCase()}`);
    try {
      const folderId = await googleDriveService.getOrCreateRootFolder();
      console.log(`✅ Connection successful! Application root folder ID: ${folderId}`);
      console.log('Verifying folder segregation...');
      const cat = await googleDriveService.getOrCreateCategoryFolder('onboarding');
      console.log(`✅ Onboarding folder ID: ${cat}`);
      console.log('========================================================================');
      console.log('5 TB Google Cloud / AI Pro storage integration is FULLY FUNCTIONAL!');
      console.log('========================================================================');
    } catch (e) {
      console.error('❌ Connection test failed:', e.message);
    }
    return;
  }

  if (googleDriveService.isConfigured() && googleDriveService.getAuthMode() === 'service_account') {
    console.log('✅ Google Drive is configured via Service Account. Run with --test to verify.');
    return;
  }

  if (!clientId || !clientSecret) {
    console.log('========================================================================');
    console.log(' GOOGLE DRIVE 5 TB INTEGRATION SETUP');
    console.log('========================================================================');
    console.log('To link your Google Drive (5 TB AI Pro / Google One quota):');
    console.log('\nOPTION A: Personal Google Account with 5 TB AI Pro / Google One (OAuth2)');
    console.log('1. Go to Google Cloud Console (https://console.cloud.google.com)');
    console.log('2. Enable "Google Drive API"');
    console.log('3. Create OAuth 2.0 Credentials:');
    console.log('   - Redirect URI: http://localhost:3000/api/files/oauth2callback');
    console.log('4. Open your .env file in the IDE:');
    console.log('   Set GOOGLE_DRIVE_CLIENT_ID=<your-client-id>');
    console.log('   Set GOOGLE_DRIVE_CLIENT_SECRET=<your-client-secret>');
    console.log('5. Run this script again: npm run storage:setup');
    console.log('\nOPTION B: Google Cloud Service Account');
    console.log('1. Download service-account.json from Google Cloud Console.');
    console.log('2. Place it in this project folder as service-account.json or set GOOGLE_APPLICATION_CREDENTIALS');
    console.log('\n(In the meantime, the portal works in Local Staging mode automatically)');
    console.log('========================================================================');
    process.exit(0);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  console.log('========================================================================');
  console.log(' 1. Authorize HR Portal to use your Google Drive storage:');
  console.log(' Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n========================================================================');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question(' 2. Paste the authorization code from the redirect URL here: ', async (code) => {
    rl.close();
    try {
      const { tokens } = await oauth2Client.getToken(code.trim());
      console.log('\n Authorization successful! Refresh token obtained.');
      
      // Update .env file
      const envPath = path.resolve(__dirname, '..', '.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      
      if (envContent.includes('GOOGLE_DRIVE_REFRESH_TOKEN=')) {
        envContent = envContent.replace(
          /GOOGLE_DRIVE_REFRESH_TOKEN=.*/,
          `GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`
        );
      } else {
        envContent += `\nGOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
      }

      fs.writeFileSync(envPath, envContent);
      console.log(' Saved GOOGLE_DRIVE_REFRESH_TOKEN to .env automatically!');
      console.log(' Your 5 TB Google Drive storage integration is now ACTIVE!');
    } catch (err) {
      console.error(' Failed to exchange code for tokens:', err.message);
    }
  });
}

main().catch(console.error);
