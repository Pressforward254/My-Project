import { verifyToken } from '../lib/auth.js';

// Attaches req.auth = { centerId, role, sub, section? } from a verified JWT.
// centerId here is the ONLY source of truth for which center's data a request
// can touch — it is never read from the request body, query string, or URL,
// so a client can't simply pass a different centerId to reach another center's data.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    req.auth = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    // it_support can do everything a school_admin, teacher, or student can —
    // that's the entire point of the IT dimension existing.
    if (req.auth && req.auth.role === 'it_support') return next();
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: `This action requires one of: ${roles.join(', ')}` });
    }
    next();
  };
}
