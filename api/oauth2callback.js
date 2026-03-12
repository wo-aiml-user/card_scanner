const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  try {
    const forwardedProto = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().trim();
    const protocol = forwardedProto || (host.includes('localhost') ? 'http' : 'https');
    const isLocalhost = host.includes('localhost') || host.startsWith('127.0.0.1');

    const { code } = req.query;

    if (!code) {
      return res.status(400).send('No authorization code provided');
    }

    // Get credentials from environment
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    // Must match /api/auth/google redirect URI exactly.
    const redirectUri = isLocalhost
      ? `${protocol}://${host}/api/oauth2callback`
      : (process.env.OAUTH_REDIRECT_URI || `${protocol}://${host}/api/oauth2callback`);

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    const sessionData = {
      userId: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      tokens: tokens,
      createdAt: Date.now()
    };

    // Create user's personal Google Sheet
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const spreadsheetName = 'cards_details';
    const fileList = await drive.files.list({
      q: `name='${spreadsheetName}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
      fields: 'files(id, name)',
    });

    let spreadsheetId;
    if (fileList.data.files && fileList.data.files.length > 0) {
      spreadsheetId = fileList.data.files[0].id;
    } else {
      const createResponse = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title: spreadsheetName,
          },
          sheets: [
            {
              properties: {
                title: 'Sheet1',
              },
            },
          ],
        },
      });
      spreadsheetId = createResponse.data.spreadsheetId;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Sheet1!A1:I1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Name', 'Company', 'Job Title', 'Email', 'Phone', 'Website', 'Address', 'Social Links', 'Timestamp']],
        },
      });
    }

    sessionData.spreadsheetId = spreadsheetId;
    
    // Store all session data in encrypted cookie (since in-memory doesn't persist on Vercel)
    // Base64 encode the session data
    const sessionDataJson = JSON.stringify(sessionData);
    const sessionDataBase64 = Buffer.from(sessionDataJson).toString('base64');
    const cookieValue = encodeURIComponent(sessionDataBase64);
    const cookieHost = (req.headers.host || '').toLowerCase();
    const isCookieLocalhost = cookieHost.includes('localhost') || cookieHost.startsWith('127.0.0.1');
    const cookieSecurity = isCookieLocalhost ? '' : 'Secure; ';
    const sameSite = isCookieLocalhost ? 'Lax' : 'None';
    
    // Store as cookie (without HttpOnly so we can read it in client-side if needed)
    res.setHeader('Set-Cookie', `userData=${cookieValue}; ${cookieSecurity}SameSite=${sameSite}; Max-Age=${30 * 24 * 60 * 60}; Path=/`);
    
    // Close the popup window and redirect parent
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Complete</title>
        </head>
        <body>
          <script>
            // Send message to parent window
            window.opener.postMessage('auth_success', '*');
            window.close();
          </script>
        </body>
      </html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return res.status(500).send('Authentication failed: ' + error.message);
  }
}
