CREATE TABLE IF NOT EXISTS rider (
  rider_id BIGSERIAL PRIMARY KEY,
  name     VARCHAR(120) NOT NULL,
  email    VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS driver (
  driver_id BIGSERIAL PRIMARY KEY,
  name     VARCHAR(120) NOT NULL,
  email    VARCHAR(255) NOT NULL UNIQUE,
  current_latitude  NUMERIC(9,6) NOT NULL DEFAULT 0.000000,  -- -90..90
  current_longitude NUMERIC(9,6) NOT NULL DEFAULT 0.000000,  -- -180..180
  is_online  BOOLEAN   NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_presence
  ON driver (is_online, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_driver_lat_lng
  ON driver (current_latitude, current_longitude);

CREATE TABLE IF NOT EXISTS location (
  location_id             SERIAL PRIMARY KEY,
  name                    VARCHAR(120) NOT NULL UNIQUE,
  is_hot_area             BOOLEAN NOT NULL DEFAULT FALSE,
  commission_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  latitude  NUMERIC(9,6) NOT NULL,    -- -90..90
  longitude NUMERIC(9,6) NOT NULL,    -- -180..180
  CONSTRAINT location_discount_chk CHECK (commission_discount_pct BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS category (
  category_id         SERIAL PRIMARY KEY,
  name                VARCHAR(80) NOT NULL UNIQUE,
  rate_cents_per_mile INT NOT NULL CHECK (rate_cents_per_mile >= 0)
);

-- Route-specific override rates
CREATE TABLE IF NOT EXISTS fare_rule (
  category_id                INT NOT NULL REFERENCES category(category_id),
  origin_location_id         INT NOT NULL REFERENCES location(location_id),
  dest_location_id           INT NOT NULL REFERENCES location(location_id),
  route_rate_cents_per_mile  INT NOT NULL CHECK (route_rate_cents_per_mile >= 0),
  CONSTRAINT fare_rule_pk PRIMARY KEY (category_id, origin_location_id, dest_location_id)
);

CREATE TABLE IF NOT EXISTS ride (
  ride_id             BIGSERIAL PRIMARY KEY,
  rider_id            BIGINT NOT NULL REFERENCES rider(rider_id),
  driver_id           BIGINT NOT NULL REFERENCES driver(driver_id),
  category_id         INT    NOT NULL REFERENCES category(category_id),
  origin_location_id  INT    NOT NULL REFERENCES location(location_id),
  dest_location_id    INT    NOT NULL REFERENCES location(location_id),

  requested_at        TIMESTAMP NOT NULL,
  start_time          TIMESTAMP,
  end_time            TIMESTAMP,
  distance_miles      NUMERIC(8,2) NOT NULL CHECK (distance_miles >= 0),

  -- Rider-side pricing
  fare_base_cents     BIGINT NOT NULL CHECK (fare_base_cents >= 0),
  rider_fee_cents     BIGINT NOT NULL CHECK (rider_fee_cents >= 0),
  tax_cents           BIGINT NOT NULL CHECK (tax_cents >= 0),
  fare_total_cents    BIGINT NOT NULL CHECK (fare_total_cents >= 0),

  company_commission_cents BIGINT NOT NULL CHECK (company_commission_cents >= 0),
  driver_deduction_cents   BIGINT NOT NULL CHECK (driver_deduction_cents >= 0),
  driver_payout_cents      BIGINT NOT NULL CHECK (driver_payout_cents >= 0),


  company_commission_pct_applied NUMERIC(6,3) NOT NULL,
  rider_fee_pct_applied          NUMERIC(6,3) NOT NULL,
  driver_deduction_pct_applied   NUMERIC(6,3) NOT NULL,
  tax_pct_applied                NUMERIC(6,3) NOT NULL DEFAULT 8.250,
  rate_cents_per_mile_applied    INT NOT NULL CHECK (rate_cents_per_mile_applied >= 0),

  status VARCHAR(16) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','accepted','ongoing','completed','canceled'))
);

CREATE INDEX IF NOT EXISTS idx_ride_rider_requested_at
  ON ride (rider_id, requested_at);
CREATE INDEX IF NOT EXISTS idx_ride_driver_requested_at
  ON ride (driver_id, requested_at);
CREATE INDEX IF NOT EXISTS idx_ride_origin_location
  ON ride (origin_location_id);
CREATE INDEX IF NOT EXISTS idx_ride_dest_location
  ON ride (dest_location_id);

-- Payment (composite key supports multiple methods per ride)
CREATE TABLE IF NOT EXISTS payment (
  ride_id BIGINT NOT NULL REFERENCES ride(ride_id) ON DELETE CASCADE,
  method  VARCHAR(16) NOT NULL
    CHECK (method IN ('card','wallet')),
  amount_total_cents BIGINT NOT NULL CHECK (amount_total_cents >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'authorized'
    CHECK (status IN ('authorized','captured','failed')),
  payment_id BIGSERIAL NOT NULL UNIQUE,
  paid_at TIMESTAMP,
  CONSTRAINT payment_pk PRIMARY KEY (ride_id, method)
);
CREATE INDEX IF NOT EXISTS idx_payment_ride ON payment (ride_id);

-- Driver maintenance deductions
CREATE TABLE IF NOT EXISTS deduction_type (
  deduction_type_id SERIAL PRIMARY KEY,
  name              VARCHAR(80) NOT NULL UNIQUE,   
  default_pct       NUMERIC(5,2) NOT NULL,
  CONSTRAINT deduction_type_pct_chk CHECK (default_pct BETWEEN 0 AND 100)
);