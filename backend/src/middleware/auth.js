const jwt = require('jsonwebtoken');

// auth() = any logged-in user, auth(['driver']) = only these roles
exports.auth = (roles = []) => (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    if (roles.length && !roles.includes(p.role)) return res.status(403).json({ error: 'forbidden' });
    req.user = p;
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
};
