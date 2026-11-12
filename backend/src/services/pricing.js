// Pure functions: no DB access, easy to unit-test.
const RATES = {
  economy: { base: 5, perKm: 2, perMin: 0.5, minFare: 10 },
  comfort: { base: 8, perKm: 3, perMin: 0.7, minFare: 15 },
  van: { base: 10, perKm: 4, perMin: 0.9, minFare: 20 },
};

const toRad = (d) => (d * Math.PI) / 180;

function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// fare = (base + km*perKm + min*perMin) * surge, floor at minFare, then promo discount
function estimate({ pickup, dropoff, type = 'economy', surge = 1, discountPercent = 0 }) {
  const r = RATES[type];
  if (!r) throw new Error('invalid vehicle type');
  const km = +(haversineKm(pickup, dropoff) * 1.3).toFixed(2); // 1.3 = road factor
  const min = Math.max(1, Math.round((km / 30) * 60)); // assume 30 km/h average
  let fare = (r.base + km * r.perKm + min * r.perMin) * surge;
  fare = Math.max(fare, r.minFare);
  const discount = (fare * discountPercent) / 100;
  fare = +(fare - discount).toFixed(2);
  return { distance_km: km, duration_min: min, surge, discount: +discount.toFixed(2), fare, vehicle_type: type };
}

const validPoint = (p) =>
  p && typeof p.lat === 'number' && typeof p.lng === 'number' &&
  p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;

module.exports = { RATES, haversineKm, estimate, validPoint };
