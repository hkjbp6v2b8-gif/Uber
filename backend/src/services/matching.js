const redis = require('../config/redis');
const db = require('../config/db');

const KEY = 'drivers:online';

async function findNearby(lat, lng, radiusKm = 5, count = 10) {
  return redis.geoSearch(
    KEY,
    { longitude: lng, latitude: lat },
    { radius: radiusKm, unit: 'km' },
    { SORT: 'ASC', COUNT: count }
  );
}

const setOnline = (id, lat, lng) => redis.geoAdd(KEY, { longitude: lng, latitude: lat, member: id });
const setOffline = (id) => redis.zRem(KEY, id);
const isOnline = async (id) => (await redis.zScore(KEY, id)) !== null;

// pending offers: rideId -> { driverId, timer }
const offers = new Map();
const OFFER_SECONDS = 15;

async function dispatch(io, ride, tried = []) {
  const { rows: [cur] } = await db.query('SELECT status FROM rides WHERE id=$1', [ride.id]);
  if (!cur || cur.status !== 'requested') return; // cancelled meanwhile

  let ids = (await findNearby(ride.pickup_lat, ride.pickup_lng, 5, 20)).filter((d) => !tried.includes(d));
  if (ids.length) {
    // keep only drivers whose vehicle matches the requested type, preserving distance order
    const { rows } = await db.query('SELECT DISTINCT driver_id FROM vehicles WHERE driver_id = ANY($1) AND type = $2', [ids, ride.vehicle_type]);
    const ok = new Set(rows.map((r) => r.driver_id));
    ids = ids.filter((d) => ok.has(d));
  }
  if (!ids.length) {
    await db.query("UPDATE rides SET status='no_drivers_found' WHERE id=$1 AND status='requested'", [ride.id]);
    io.to(`user:${ride.rider_id}`).emit('ride:status_changed', { rideId: ride.id, status: 'no_drivers_found' });
    return;
  }
  const driverId = ids[0];
  io.to(`user:${driverId}`).emit('ride:new_request', {
    rideId: ride.id,
    pickup: { lat: ride.pickup_lat, lng: ride.pickup_lng, address: ride.pickup_address },
    dropoff: { lat: ride.dropoff_lat, lng: ride.dropoff_lng, address: ride.dropoff_address },
    fare: ride.fare,
    distance_km: ride.distance_km,
    expires_in: OFFER_SECONDS,
  });
  const timer = setTimeout(() => {
    offers.delete(ride.id);
    dispatch(io, ride, [...tried, driverId]).catch(console.error);
  }, OFFER_SECONDS * 1000);
  offers.set(ride.id, { driverId, timer });
}

// returns true only if this driver currently holds the offer
function claimOffer(rideId, driverId) {
  const o = offers.get(rideId);
  if (!o || o.driverId !== driverId) return false;
  clearTimeout(o.timer);
  offers.delete(rideId);
  return true;
}

// returns the driver who held the offer (so the caller can notify them), or null
function clearOffer(rideId) {
  const o = offers.get(rideId);
  if (!o) return null;
  clearTimeout(o.timer);
  offers.delete(rideId);
  return o.driverId;
}

// put a driver back in the matching pool using their last known position
async function releaseDriver(id) {
  await db.query("UPDATE drivers SET status='online' WHERE user_id=$1", [id]);
  const pos = await redis.get(`driver:pos:${id}`);
  if (pos) { const { lat, lng } = JSON.parse(pos); await setOnline(id, lat, lng); }
}

module.exports = { findNearby, setOnline, setOffline, isOnline, dispatch, claimOffer, clearOffer, releaseDriver };
