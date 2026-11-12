const router = require('express').Router();
const db = require('../config/db');
const { auth } = require('../middleware/auth');
const { estimate, validPoint } = require('../services/pricing');
const { surgeFor, promoPercent } = require('../services/surge');
const M = require('../services/matching');

const ACTIVE = ['requested', 'accepted', 'arrived', 'in_progress'];
const commission = () => parseFloat(process.env.PLATFORM_COMMISSION || '0.2');

async function rideView(id) {
  const { rows: [r] } = await db.query(
    `SELECT r.*, du.name AS driver_name, du.rating AS driver_rating, ru.name AS rider_name,
            v.make, v.model, v.plate, v.color
     FROM rides r
     LEFT JOIN users du ON du.id = r.driver_id
     LEFT JOIN users ru ON ru.id = r.rider_id
     LEFT JOIN LATERAL (SELECT * FROM vehicles WHERE driver_id = r.driver_id ORDER BY id LIMIT 1) v ON true
     WHERE r.id = $1`, [id]);
  return r;
}

function notify(io, r) {
  const p = { rideId: r.id, status: r.status };
  io.to(`user:${r.rider_id}`).emit('ride:status_changed', p);
  if (r.driver_id) io.to(`user:${r.driver_id}`).emit('ride:status_changed', p);
}

// ---------- rider ----------
router.post('/estimate', auth(['rider']), async (req, res) => {
  const { pickup, dropoff, vehicle_type = 'economy', promo_code } = req.body || {};
  if (!validPoint(pickup) || !validPoint(dropoff)) return res.status(400).json({ error: 'invalid coordinates' });
  try {
    const surge = await surgeFor(pickup);
    const discountPercent = await promoPercent(promo_code);
    res.json(estimate({ pickup, dropoff, type: vehicle_type, surge, discountPercent }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/', auth(['rider']), async (req, res) => {
  const { pickup, dropoff, vehicle_type = 'economy', payment_method = 'cash', promo_code } = req.body || {};
  if (!validPoint(pickup) || !validPoint(dropoff)) return res.status(400).json({ error: 'invalid coordinates' });
  if (!['cash', 'wallet'].includes(payment_method))
    return res.status(400).json({ error: 'payment method not available (card needs a payment gateway)' });
  try {
    const { rows: busy } = await db.query('SELECT 1 FROM rides WHERE rider_id=$1 AND status = ANY($2)', [req.user.id, ACTIVE]);
    if (busy.length) return res.status(409).json({ error: 'you already have an active ride' });

    const surge = await surgeFor(pickup);
    const pct = await promoPercent(promo_code);
    const est = estimate({ pickup, dropoff, type: vehicle_type, surge, discountPercent: pct });

    if (payment_method === 'wallet') {
      const { rows: [u] } = await db.query('SELECT wallet_balance FROM users WHERE id=$1', [req.user.id]);
      if (Number(u.wallet_balance) < est.fare) return res.status(402).json({ error: 'insufficient wallet balance' });
    }
    const { rows: [row] } = await db.query(
      `INSERT INTO rides(rider_id,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,
         vehicle_type,distance_km,duration_min,surge,fare,payment_method,promo_code)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.user.id, pickup.lat, pickup.lng, pickup.address || null, dropoff.lat, dropoff.lng, dropoff.address || null,
       vehicle_type, est.distance_km, est.duration_min, est.surge, est.fare, payment_method, pct ? promo_code : null]);
    if (pct) await db.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE code=$1', [promo_code]);

    const io = req.app.get('io');
    io.in(`user:${req.user.id}`).socketsJoin(`ride:${row.id}`);
    M.dispatch(io, row).catch(console.error);
    res.status(201).json({ ride: await rideView(row.id), estimate: est });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server error' }); }
});

router.get('/active', auth(), async (req, res) => {
  const { rows: [x] } = await db.query(
    'SELECT id FROM rides WHERE (rider_id=$1 OR driver_id=$1) AND status = ANY($2) ORDER BY requested_at DESC LIMIT 1',
    [req.user.id, ACTIVE]);
  res.json({ ride: x ? await rideView(x.id) : null });
});

router.get('/history', auth(), async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM rides WHERE rider_id=$1 OR driver_id=$1 ORDER BY requested_at DESC LIMIT 50', [req.user.id]);
  res.json({ rides: rows });
});

router.get('/:id', auth(), async (req, res) => {
  const r = await rideView(req.params.id).catch(() => null);
  if (!r || (r.rider_id !== req.user.id && r.driver_id !== req.user.id && req.user.role !== 'admin'))
    return res.status(404).json({ error: 'ride not found' });
  res.json({ ride: r });
});

router.post('/:id/cancel', auth(['rider', 'driver']), async (req, res) => {
  const { rows: [r] } = await db.query('SELECT * FROM rides WHERE id=$1', [req.params.id]).catch(() => ({ rows: [] }));
  if (!r || (r.rider_id !== req.user.id && r.driver_id !== req.user.id)) return res.status(404).json({ error: 'ride not found' });
  if (!['requested', 'accepted', 'arrived'].includes(r.status)) return res.status(409).json({ error: 'ride can no longer be cancelled' });
  const to = req.user.id === r.rider_id ? 'cancelled_by_rider' : 'cancelled_by_driver';
  const { rows: [u] } = await db.query('UPDATE rides SET status=$1 WHERE id=$2 AND status=$3 RETURNING *', [to, r.id, r.status]);
  if (!u) return res.status(409).json({ error: 'ride state changed' });
  const io = req.app.get('io');
  const offered = M.clearOffer(r.id);
  if (offered) io.to(`user:${offered}`).emit('ride:status_changed', { rideId: r.id, status: to });
  if (r.driver_id) await M.releaseDriver(r.driver_id);
  notify(io, u);
  res.json({ ride: u });
});

router.post('/:id/rate', auth(['rider', 'driver']), async (req, res) => {
  const { score, comment } = req.body || {};
  if (!Number.isInteger(score) || score < 1 || score > 5) return res.status(400).json({ error: 'score must be 1-5' });
  const { rows: [r] } = await db.query("SELECT * FROM rides WHERE id=$1 AND status='completed'", [req.params.id]).catch(() => ({ rows: [] }));
  if (!r || (r.rider_id !== req.user.id && r.driver_id !== req.user.id)) return res.status(404).json({ error: 'completed ride not found' });
  const to = req.user.id === r.rider_id ? r.driver_id : r.rider_id;
  try {
    await db.query('INSERT INTO ratings(ride_id,from_user,to_user,score,comment) VALUES($1,$2,$3,$4,$5)', [r.id, req.user.id, to, score, comment || null]);
    await db.query('UPDATE users SET rating = round((rating*rating_count + $1)/(rating_count+1), 2), rating_count = rating_count + 1 WHERE id=$2', [score, to]);
    res.json({ rated: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'already rated' });
    throw e;
  }
});

// ---------- driver ----------
router.post('/:id/accept', auth(['driver']), async (req, res) => {
  if (!M.claimOffer(req.params.id, req.user.id)) return res.status(409).json({ error: 'offer expired or not addressed to you' });
  const { rows: [r] } = await db.query(
    "UPDATE rides SET driver_id=$1, status='accepted', accepted_at=now() WHERE id=$2 AND status='requested' RETURNING *",
    [req.user.id, req.params.id]);
  if (!r) return res.status(409).json({ error: 'ride no longer available' });
  await db.query("UPDATE drivers SET status='busy' WHERE user_id=$1", [req.user.id]);
  await M.setOffline(req.user.id);
  const io = req.app.get('io');
  io.in(`user:${req.user.id}`).socketsJoin(`ride:${r.id}`);
  io.in(`user:${r.rider_id}`).socketsJoin(`ride:${r.id}`);
  notify(io, r);
  res.json({ ride: await rideView(r.id) });
});

async function transition(req, res, from, to, extra = '') {
  const { rows: [r] } = await db.query(
    `UPDATE rides SET status=$1${extra} WHERE id=$2 AND driver_id=$3 AND status=$4 RETURNING *`,
    [to, req.params.id, req.user.id, from]).catch(() => ({ rows: [] }));
  if (!r) { res.status(409).json({ error: `ride must be in status ${from}` }); return null; }
  notify(req.app.get('io'), r);
  return r;
}

router.post('/:id/arrived', auth(['driver']), async (req, res) => {
  const r = await transition(req, res, 'accepted', 'arrived');
  if (r) res.json({ ride: await rideView(r.id) });
});

router.post('/:id/start', auth(['driver']), async (req, res) => {
  const r = await transition(req, res, 'arrived', 'in_progress', ', started_at=now()');
  if (r) res.json({ ride: await rideView(r.id) });
});

router.post('/:id/complete', auth(['driver']), async (req, res) => {
  const r = await transition(req, res, 'in_progress', 'completed', ', ended_at=now()');
  if (!r) return;
  const earning = +(r.fare * (1 - commission())).toFixed(2);
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await c.query('UPDATE rides SET driver_earning=$1 WHERE id=$2', [earning, r.id]);
    let status = 'pending';
    if (r.payment_method === 'cash') status = 'paid';
    if (r.payment_method === 'wallet') {
      const u = await c.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id=$2 AND wallet_balance >= $1 RETURNING id', [r.fare, r.rider_id]);
      if (u.rowCount) {
        status = 'paid';
        await c.query("INSERT INTO wallet_transactions(user_id,amount,kind,ride_id) VALUES($1,$2,'ride_payment',$3)", [r.rider_id, -r.fare, r.id]);
      }
    }
    await c.query('INSERT INTO payments(ride_id,amount,method,status) VALUES($1,$2,$3,$4)', [r.id, r.fare, r.payment_method, status]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); console.error(e); } finally { c.release(); }
  await M.releaseDriver(req.user.id);
  res.json({ ride: await rideView(r.id) });
});

module.exports = router;
