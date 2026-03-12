const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  const requestOrigin = req.headers.origin;

  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );
  if (requestOrigin) {
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const parseCookies = (cookieHeader = '') => {
      return cookieHeader.split(';').reduce((acc, part) => {
        const trimmed = part.trim();
        if (!trimmed) return acc;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) return acc;

        const key = trimmed.slice(0, separatorIndex);
        const value = trimmed.slice(separatorIndex + 1);
        acc[key] = decodeURIComponent(value);
        return acc;
      }, {});
    };

    // Parse cookies
    const cookies = parseCookies(req.headers.cookie || '');

    const userDataCookie = cookies.userData;

    if (!userDataCookie) {
      return res.status(401).json({ error: 'Not authenticated. Please sign in.' });
    }

    // Decode session data from cookie
    const sessionDataJson = Buffer.from(userDataCookie, 'base64').toString('utf8');
    const session = JSON.parse(sessionDataJson);
    
    // Get user's spreadsheet ID from session
    const spreadsheetId = session.spreadsheetId;

    if (!spreadsheetId) {
      return res.status(500).json({ error: 'User spreadsheet not found' });
    }

    // Get credentials from environment
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.OAUTH_REDIRECT_URI;

    // Recreate OAuth client from session tokens
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );
    
    oauth2Client.setCredentials(session.tokens);
    
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // Read all rows from the sheet (skip header row)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!A2:I', // Skip header row
    });

    const rows = response.data.values || [];
    
    // Transform rows into card data
    const cards = rows.map((row, index) => ({
      id: `sheet-${index}`,
      data: {
        name: row[0] || '',
        company: row[1] || '',
        job_title: row[2] || '',
        email: row[3] || '',
        phone: row[4] || '',
        website: row[5] || '',
        address: row[6] || '',
        social_links: row[7] ? row[7].split(', ').filter(link => link.trim()) : [],
      },
      timestamp: row[8] || ''
    }));

    return res.json({ 
      success: true, 
      cards,
      total: cards.length
    });
  } catch (error) {
    console.error('Error listing cards:', error);
    return res.status(500).json({ error: error.message });
  }
}

