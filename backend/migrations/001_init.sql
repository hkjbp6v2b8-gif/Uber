CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('rider','driver','admin')),
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  rating NUMERIC(3,2) NOT NULL DEFAULT 5.00,
  rating_count INT NOT NULL DEFAULT 0,
  wallet_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  fcm_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drivers (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  license_no TEXT,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('offline','online','busy')),
  approved BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  make TEXT NOT NULL, model TEXT NOT NULL, plate TEXT NOT NULL, color TEXT,
  type TEXT NOT NULL DEFAULT 'economy' CHECK (type IN ('economy','comfort','van'))
);

CREATE TABLE IF NOT EXISTS promo_codes (
  code TEXT PRIMARY KEY,
  discount_percent INT NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  expiry DATE,
  usage_limit INT,
  used_count INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NOT NULL REFERENCES users(id),
  driver_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN
    ('requested','accepted','arrived','in_progress','completed',
     'cancelled_by_rider','cancelled_by_driver','no_drivers_found')),
  pickup_lat DOUBLE PRECISION NOT NULL, pickup_lng DOUBLE PRECISION NOT NULL, pickup_address TEXT,
  dropoff_lat DOUBLE PRECISION NOT NULL, dropoff_lng DOUBLE PRECISION NOT NULL, dropoff_address TEXT,
  vehicle_type TEXT NOT NULL DEFAULT 'economy',
  distance_km NUMERIC(8,2), duration_min INT,
  surge NUMERIC(3,2) NOT NULL DEFAULT 1,
  fare NUMERIC(10,2) NOT NULL,
  driver_earning NUMERIC(10,2),
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','wallet','card')),
  promo_code TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ, started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS rides_rider_idx ON rides(rider_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS rides_driver_idx ON rides(driver_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS rides_status_idx ON rides(status);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id),
  amount NUMERIC(10,2) NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  provider_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id),
  from_user UUID NOT NULL REFERENCES users(id),
  to_user UUID NOT NULL REFERENCES users(id),
  score INT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  UNIQUE (ride_id, from_user)
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(10,2) NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('topup','ride_payment','ride_earning','refund')),
  ride_id UUID REFERENCES rides(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, body TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
