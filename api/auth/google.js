const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  const forwardedProto = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().trim();
  const protocol = forwardedProto || (host.includes('localhost') ? 'http' : 'https');

  // Get credentials from environment
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  // Prefer explicit env, but fall back to current request host to avoid redirect_uri_mismatch.
  const redirectUri = process.env.OAUTH_REDIRECT_URI || `${protocol}://${host}/api/oauth2callback`;

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/contacts'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  return res.redirect(authUrl);
}
