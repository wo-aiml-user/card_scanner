module.exports = async function handler(req, res) {
  const requestOrigin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
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

    // Parse cookies manually
    const cookies = parseCookies(req.headers.cookie || '');

    const userDataCookie = cookies.userData;

    if (!userDataCookie) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Decode base64 session data
    const sessionDataJson = Buffer.from(userDataCookie, 'base64').toString('utf8');
    const sessionData = JSON.parse(sessionDataJson);
    
    const { userId, email, name, picture, spreadsheetId } = sessionData;

    return res.json({
      userId,
      email,
      name,
      picture,
      spreadsheetId
    });
  } catch (error) {
    console.error('User endpoint error:', error);
    return res.status(500).json({ error: error.message });
  }
}
