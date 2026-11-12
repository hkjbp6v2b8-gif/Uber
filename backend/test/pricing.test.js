const test = require('node:test');
const assert = require('node:assert');
const { estimate, haversineKm, validPoint } = require('../src/services/pricing');

const A = { lat: 24.7136, lng: 46.6753 };
const B = { lat: 24.7743, lng: 46.7386 };

test('haversine is ~0 for same point', () => assert.ok(haversineKm(A, A) < 0.001));

test('minimum fare applies to very short trips', () => {
  assert.strictEqual(estimate({ pickup: A, dropoff: A }).fare, 10);
});

test('surge raises fare', () => {
  const n = estimate({ pickup: A, dropoff: B });
  const s = estimate({ pickup: A, dropoff: B, surge: 2 });
  assert.ok(s.fare > n.fare);
});

test('promo discount lowers fare', () => {
  const n = estimate({ pickup: A, dropoff: B });
  const d = estimate({ pickup: A, dropoff: B, discountPercent: 50 });
  assert.ok(Math.abs(d.fare - n.fare / 2) < 0.02);
});

test('invalid vehicle type throws', () => assert.throws(() => estimate({ pickup: A, dropoff: B, type: 'rocket' })));

test('validPoint', () => {
  assert.ok(validPoint(A));
  assert.ok(!validPoint({ lat: 200, lng: 0 }));
  assert.ok(!validPoint(null));
});
