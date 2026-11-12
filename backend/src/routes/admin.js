const router = require('express').Router();
const db = require('../config/db');
const { auth } = require('../middleware/auth');

router.use(auth(['admin']));

router.get('/stats', async (_req, res) => {
  const { rows: [s] } = await db.query(`SELECT
    (SELECT COUNT(*)::int FROM users WHERE role='rider') AS riders,
    (SELECT COUNT(*)::int FROM users WHERE role='driver') AS drivers,
    (SELECT COUNT(*)::int FROM drivers WHERE status='online') AS drivers_online,
    (SELECT COUNT(*)::int FROM rides) AS rides_total,
    (SELECT COUNT(*)::int FROM rides WHERE status='completed') AS rides_completed,
    (SELECT COALESCE(SUM(fare),0) FROM rides WHERE status='completed') AS revenue`);
  res.json(s);
});

router.get('/users', async (_req, res) => {
  const { rows } = await db.query(
    `SELECT u.id,u.name,u.phone,u.role,u.rating,u.created_at,d.approved,d.status AS driver_status
     FROM users u LEFT JOIN drivers d ON d.user_id=u.id ORDER BY u.created_at DESC LIMIT 200`);
  res.json({ users: rows });
});

router.get('/rides', async (_req, res) => {
  const { rows } = await db.query('SELECT * FROM rides ORDER BY requested_at DESC LIMIT 200');
  res.json({ rides: rows });
});

router.patch('/drivers/:id/approve', async (req, res) => {
  const approved = req.body?.approved !== false;
  const { rowCount } = await db.query('UPDATE drivers SET approved=$1 WHERE user_id=$2', [approved, req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'driver not found' });
  res.json({ approved });
});

router.post('/promos', async (req, res) => {
  const { code, discount_percent, expiry, usage_limit } = req.body || {};
  if (!code || !(discount_percent >= 1 && discount_percent <= 100)) return res.status(400).json({ error: 'code and discount_percent (1-100) required' });
  await db.query('INSERT INTO promo_codes(code,discount_percent,expiry,usage_limit) VALUES($1,$2,$3,$4)', [code, discount_percent, expiry || null, usage_limit || null]);
  res.status(201).json({ created: true });
});

module.exports = router;
