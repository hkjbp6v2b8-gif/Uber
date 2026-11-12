const db = require('../config/db');
const { findNearby } = require('./matching');

// surge = 1 + 0.1 per unserved request above the number of nearby drivers (cap 2.5)
async function surgeFor(pickup) {
  const { rows: [d] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM rides
     WHERE status='requested' AND requested_at > now() - interval '10 minutes'
       AND abs(pickup_lat - $1) < 0.03 AND abs(pickup_lng - $2) < 0.03`,
    [pickup.lat, pickup.lng]
  );
  const supply = (await findNearby(pickup.lat, pickup.lng, 3, 50)).length;
  const s = 1 + Math.max(0, d.n - supply) * 0.1;
  return +Math.min(2.5, s).toFixed(2);
}

async function promoPercent(code) {
  if (!code) return 0;
  const { rows: [p] } = await db.query(
    `SELECT discount_percent FROM promo_codes
     WHERE code=$1 AND (expiry IS NULL OR expiry >= current_date)
       AND (usage_limit IS NULL OR used_count < usage_limit)`,
    [code]
  );
  return p ? p.discount_percent : 0;
}

module.exports = { surgeFor, promoPercent };
