// In-memory session store (use a database in production)
const sessions = {};

module.exports = async function handler(req, res) {
  try {
    const sessionId = req.cookies?.sessionId || req.headers.cookie?.match(/sessionId=([^;]+)/)?.[1];
    
    if (sessionId && sessions[sessionId]) {
      delete sessions[sessionId];
    }

    res.setHeader('Set-Cookie', 'sessionId=; HttpOnly; Secure; SameSite=None; Max-Age=0; Path=/');
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: error.message });
  }
}