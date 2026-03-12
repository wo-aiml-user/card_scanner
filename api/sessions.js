// Shared session store
// In production, use a database (Redis, MongoDB, etc.)
const sessions = {};

export function getSession(sessionId) {
  return sessions[sessionId] || null;
}

export function setSession(sessionId, data) {
  sessions[sessionId] = data;
}

export function deleteSession(sessionId) {
  delete sessions[sessionId];
}

export function getAllSessions() {
  return sessions;
}
