const { google } = require('googleapis');

const parseJsonBody = (req) => {
  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(req.body);
  }

  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
};

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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    req.body = await parseJsonBody(req);

    // Parse cookies
    const cookies = parseCookies(req.headers.cookie || '');

    const userDataCookie = cookies.userData;

    if (!userDataCookie) {
      return res.status(401).json({ error: 'Not authenticated. Please sign in.' });
    }

    // Decode session data from cookie
    const sessionDataJson = Buffer.from(userDataCookie, 'base64').toString('utf8');
    const session = JSON.parse(sessionDataJson);
    
    const { cardData } = req.body;

    if (!cardData) {
      return res.status(400).json({ error: 'Card data is required' });
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
    
    // Use Google People API
    const people = google.people({ version: 'v1', auth: oauth2Client });

    // Create contact
    const contact = {
      names: [
        {
          givenName: cardData.name || '',
          middleName: '',
          familyName: cardData.company || ''
        }
      ],
      emailAddresses: cardData.email ? [
        {
          value: cardData.email,
          type: 'work'
        }
      ] : [],
      phoneNumbers: cardData.phone ? [
        {
          value: cardData.phone,
          type: 'work'
        }
      ] : [],
      organizations: cardData.company ? [
        {
          name: cardData.company,
          title: cardData.job_title || '',
          type: 'work'
        }
      ] : [],
      addresses: cardData.address ? [
        {
          streetAddress: cardData.address,
          type: 'work'
        }
      ] : [],
      urls: cardData.website ? [
        {
          value: cardData.website,
          type: 'work'
        }
      ] : []
    };

    const createResponse = await people.people.createContact({
      requestBody: contact
    });

    return res.json({ 
      success: true, 
      message: 'Contact added to Google Contacts',
      contactId: createResponse.data.resourceName
    });
  } catch (error) {
    console.error('Error adding to contacts:', error);
    return res.status(500).json({ error: error.message });
  }
}

