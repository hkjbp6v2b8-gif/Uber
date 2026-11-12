const router = require('express').Router();
const db = require('../config/db');
const redis = require('../config/redis');
const { auth } = require('../middleware/auth');
const M = require('../services/matching');

router.use(auth(['driver']));

router.post('/vehicle', async (req, res) => {
  const { make, model, plate, color, type = 'economy' } = req.body || {};
  if (!make || !model || !plate) return res.status(400).json({ error: 'make, model and plate required' });
  if (!['economy', 'comfort', 'van'].includes(type)) return res.status(400).json({ error: 'invalid type' });
  const { rows: [v] } = await db.query(
    'INSERT INTO vehicles(driver_id,make,model,plate,color,type) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.user.id, make, model, plate, color || null, type]);
  res.status(201).json({ vehicle: v });
});

router.patch('/status', async (req, res) => {
  const { status, lat, lng } = req.body || {};
  if (!['online', 'offline'].includes(status)) return res.status(400).json({ error: 'status must be online or offline' });
  const { rows: [d] } = await db.query('SELECT * FROM drivers WHERE user_id=$1', [req.user.id]);
  if (!d) return res.status(404).json({ error: 'driver profile not found' });
  if (!d.approved) return res.status(403).json({ error: 'account pending admin approval' });
  if (d.status === 'busy') return res.status(409).json({ error: 'finish your current ride first' });
  if (status === 'online') {
    if (typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'lat and lng required' });
    const { rowCount } = await db.query('SELECT 1 FROM vehicles WHERE driver_id=$1', [req.user.id]);
    if (!rowCount) return res.status(400).json({ error: 'register a vehicle first' });
    await M.setOnline(req.user.id, lat, lng);
    await redis.set(`driver:pos:${req.user.id}`, JSON.stringify({ lat, lng }), { EX: 300 });
  } else {
    await M.setOffline(req.user.id);
  }
  await db.query('UPDATE drivers SET status=$1 WHERE user_id=$2', [status, req.user.id]);
  res.json({ status });
});

router.get('/earnings', async (req, res) => {
  const { rows: [t] } = await db.query(
    `SELECT COALESCE(SUM(driver_earning),0) AS total, COUNT(*)::int AS rides,
            COALESCE(SUM(driver_earning) FILTER (WHERE ended_at >= current_date),0) AS today
     FROM rides WHERE driver_id=$1 AND status='completed'`, [req.user.id]);
  res.json(t);
});

module.exports = router;
