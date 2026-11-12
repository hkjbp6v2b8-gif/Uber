const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../config/db');
const redis = require('../config/redis');

router.use(rateLimit({ windowMs: 60_000, max: 30 }));

const issue = (u) => ({
  accessToken: jwt.sign({ id: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '1h' }),
  refreshToken: jwt.sign({ id: u.id, role: u.role }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' }),
});
const pub = (u) => ({ id: u.id, name: u.name, phone: u.phone, role: u.role, rating: u.rating, phone_verified: u.phone_verified });

router.post('/register', async (req, res) => {
  const { name, phone, email, password, role = 'rider', license_no } = req.body || {};
  if (!name || !phone || !password || password.length < 8)
    return res.status(400).json({ error: 'name, phone and password (8+ chars) are required' });
  if (!['rider', 'driver'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows: [u] } = await db.query(
      'INSERT INTO users(name,phone,email,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [name, phone, email || null, hash, role]
    );
    if (role === 'driver') {
      const approved = process.env.AUTO_APPROVE_DRIVERS === 'true';
      await db.query('INSERT INTO drivers(user_id,license_no,approved) VALUES($1,$2,$3)', [u.id, license_no || null, approved]);
    }
    res.status(201).json({ user: pub(u), ...issue(u) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'phone or email already registered' });
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

router.post('/login', async (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: 'phone and password required' });
  const { rows: [u] } = await db.query('SELECT * FROM users WHERE phone=$1', [phone]);
  if (!u || !(await bcrypt.compare(password, u.password_hash)))
    return res.status(401).json({ error: 'wrong phone or password' });
  res.json({ user: pub(u), ...issue(u) });
});

// OTP: in development the code is returned in the response.
// In production plug an SMS provider (e.g. Twilio) where marked.
router.post('/request-otp', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await redis.set(`otp:${phone}`, code, { EX: 300 });
  // TODO: send `code` by SMS provider here
  res.json({ sent: true, ...(process.env.NODE_ENV !== 'production' && { dev_code: code }) });
});

router.post('/verify-otp', async (req, res) => {
  const { phone, code } = req.body || {};
  const saved = await redis.get(`otp:${phone}`);
  if (!saved || saved !== String(code)) return res.status(400).json({ error: 'invalid or expired code' });
  await redis.del(`otp:${phone}`);
  await db.query('UPDATE users SET phone_verified=true WHERE phone=$1', [phone]);
  res.json({ verified: true });
});

router.post('/refresh', async (req, res) => {
  try {
    const p = jwt.verify(req.body?.refreshToken, process.env.JWT_REFRESH_SECRET);
    const { rows: [u] } = await db.query('SELECT * FROM users WHERE id=$1', [p.id]);
    if (!u) return res.status(401).json({ error: 'user not found' });
    res.json(issue(u));
  } catch {
    res.status(401).json({ error: 'invalid refresh token' });
  }
});

module.exports = router;
