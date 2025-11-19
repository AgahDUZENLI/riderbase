-- TRANSACTION 1: Rider requests a ride
--  - Computes distance and fare (with hot area discounts)
--  - Inserts into ride
--  - Inserts an authorized payment row (card or wallet)
-- Parameters (in app):
--   $1 = origin_location_id
--   $2 = dest_location_id
--   $3 = category_id
--   $4 = rider_id
--   $5 = driver_id
--   $6 = payment_method ('card' or 'wallet')  -- used in host code
BEGIN;

WITH ded AS (
  SELECT
    COALESCE(
      (SELECT default_pct FROM deduction_type WHERE name = 'company_commission' LIMIT 1),
      20.00
    ) AS company_commission_pct,
    COALESCE(
      (SELECT default_pct FROM deduction_type WHERE name = 'rider_fee' LIMIT 1),
      3.00
    ) AS rider_fee_pct,
    COALESCE(
      (SELECT default_pct FROM deduction_type WHERE name = 'driver_deduction' LIMIT 1),
      5.00
    ) AS driver_deduction_pct,
    COALESCE(
      (SELECT default_pct FROM deduction_type WHERE name = 'tax' LIMIT 1),
      8.25
    ) AS tax_pct
),
loc AS (
  SELECT
    lo.location_id AS origin_id, lo.latitude AS plat, lo.longitude AS plng,
    ld.location_id AS dest_id,   ld.latitude AS dlat, ld.longitude AS dlng,
    lo.is_hot_area AS o_hot, lo.commission_discount_pct AS o_disc,
    ld.is_hot_area AS d_hot, ld.commission_discount_pct AS d_disc
  FROM location lo, location ld
  WHERE lo.location_id = $1 AND ld.location_id = $2
),
dist AS (
  SELECT
    2 * 3958.7613 * ASIN(
      SQRT(
        POWER(SIN(RADIANS(l.dlat - l.plat) / 2), 2) +
        COS(RADIANS(l.plat)) * COS(RADIANS(l.dlat)) *
        POWER(SIN(RADIANS(l.dlng - l.plng) / 2), 2)
      )
    ) AS distance_miles,
    l.o_hot OR l.d_hot AS hot_area,
    (COALESCE(l.o_disc,0) + COALESCE(l.d_disc,0))/2.0 AS avg_discount
  FROM loc l
),
rate AS (
  SELECT
    COALESCE(fr.route_rate_cents_per_mile, c.rate_cents_per_mile) AS rate_cents_per_mile_applied
  FROM category c
  LEFT JOIN fare_rule fr
    ON fr.category_id = c.category_id
   AND fr.origin_location_id = $1
   AND fr.dest_location_id   = $2
  WHERE c.category_id = $3
),
applied AS (
  SELECT
    r.rate_cents_per_mile_applied,
    GREATEST(0, LEAST(100, d.company_commission_pct - ds.avg_discount)) AS company_commission_pct_applied,
    d.rider_fee_pct          AS rider_fee_pct_applied,
    d.driver_deduction_pct   AS driver_deduction_pct_applied,
    d.tax_pct                AS tax_pct_applied,
    ds.distance_miles
  FROM rate r, ded d, dist ds
),
priced AS (
  SELECT
    distance_miles,
    rate_cents_per_mile_applied,
    company_commission_pct_applied,
    rider_fee_pct_applied,
    driver_deduction_pct_applied,
    tax_pct_applied,
    ROUND(distance_miles * rate_cents_per_mile_applied) AS fare_base_cents
  FROM applied
),
parts AS (
  SELECT
    p.*,
    ROUND(p.fare_base_cents * p.rider_fee_pct_applied / 100.0) AS rider_fee_cents,
    ROUND(
      (p.fare_base_cents + ROUND(p.fare_base_cents * p.rider_fee_pct_applied / 100.0))
      * p.tax_pct_applied / 100.0
    ) AS tax_cents
  FROM priced p
),
split AS (
  SELECT
    x.*,
    ROUND(x.fare_base_cents * x.company_commission_pct_applied / 100.0) AS company_commission_cents,
    ROUND(
      (x.fare_base_cents - ROUND(x.fare_base_cents * x.company_commission_pct_applied / 100.0))
      * x.driver_deduction_pct_applied / 100.0
    ) AS driver_deduction_cents
  FROM parts x
),
final AS (
  SELECT
    distance_miles,
    rate_cents_per_mile_applied,
    company_commission_pct_applied,
    rider_fee_pct_applied,
    driver_deduction_pct_applied,
    tax_pct_applied,
    fare_base_cents,
    rider_fee_cents,
    tax_cents,
    (fare_base_cents + rider_fee_cents + tax_cents) AS fare_total_cents,
    company_commission_cents,
    driver_deduction_cents,
    (fare_base_cents - company_commission_cents - driver_deduction_cents) AS driver_payout_cents
  FROM split
)
INSERT INTO ride (
  rider_id, driver_id, category_id, origin_location_id, dest_location_id,
  requested_at, distance_miles,
  fare_base_cents, rider_fee_cents, tax_cents, fare_total_cents,
  company_commission_cents, driver_deduction_cents, driver_payout_cents,
  company_commission_pct_applied, rider_fee_pct_applied, driver_deduction_pct_applied, tax_pct_applied,
  rate_cents_per_mile_applied, status
)
SELECT
  $4::bigint AS rider_id,
  $5::bigint AS driver_id,
  $3::int    AS category_id,
  $1::int    AS origin_id,
  $2::int    AS dest_id,
  NOW()      AS requested_at,
  f.distance_miles,
  f.fare_base_cents,
  f.rider_fee_cents,
  f.tax_cents,
  f.fare_total_cents,
  f.company_commission_cents,
  f.driver_deduction_cents,
  f.driver_payout_cents,
  f.company_commission_pct_applied,
  f.rider_fee_pct_applied,
  f.driver_deduction_pct_applied,
  f.tax_pct_applied,
  f.rate_cents_per_mile_applied,
  'requested'
FROM final f
RETURNING
  ride_id,
  fare_total_cents,
  driver_payout_cents,
  company_commission_cents,
  rider_fee_cents,
  driver_deduction_cents;

-- In the app, the host code captures:
--   :ride_id           := returned ride_id
--   :fare_total_cents  := returned fare_total_cents
--   :payment_method    := 'card' or 'wallet'

-- The payment row is inserted using host parameters:
 INSERT INTO payment (ride_id, method, amount_total_cents, status, paid_at)
 VALUES (:ride_id, :payment_method, :fare_total_cents, 'authorized', NOW())
 ON CONFLICT (ride_id, method) DO NOTHING;
COMMIT;


-- TRANSACTION 2: Driver accepts ride
--  - If wallet: debits rider wallet
--  - Credits company and driver bank accounts
--  - Marks ride as accepted and sets start_time
--
-- Parameters (in app):
--   $1 = ride_id
--   $2 = driver_id

BEGIN;

SELECT
  r.ride_id,
  r.rider_id,
  r.driver_id,
  r.status,
  r.fare_total_cents,
  r.company_commission_cents,
  r.rider_fee_cents,
  r.driver_deduction_cents,
  r.driver_payout_cents,
  p.method AS payment_method
FROM ride r
JOIN payment p ON p.ride_id = r.ride_id
WHERE r.ride_id  = $1
  AND r.driver_id = $2
  AND r.status   = 'requested'
FOR UPDATE;

-- In the app, the host code reads the row into:
--   :rider_id
--   :fare_total_cents
--   :company_commission_cents
--   :rider_fee_cents
--   :driver_deduction_cents
--   :driver_payout_cents
--   :payment_method

-- If payment_method = 'wallet', debit rider wallet:
 UPDATE bank_account
    SET balance_cents = balance_cents - :fare_total_cents
  WHERE owner_type = 'rider'
    AND rider_id   = :rider_id
    AND balance_cents >= :fare_total_cents;

-- Company receives company_commission + rider_fee + driver_deduction:
 UPDATE bank_account
    SET balance_cents = balance_cents + (:company_commission_cents + :rider_fee_cents + :driver_deduction_cents)
  WHERE owner_type = 'company';

-- Driver receives payout:
 UPDATE bank_account
    SET balance_cents = balance_cents + :driver_payout_cents
 WHERE owner_type = 'driver'
    AND driver_id  = :driver_id;

-- Mark ride as accepted
UPDATE ride
   SET status     = 'accepted',
       start_time = NOW()
 WHERE ride_id = $1;

COMMIT;


-- TRANSACTION 3: Admin truncate rides + reset balances
-- Used by /api/admin/truncate with table='ride'
BEGIN;

DELETE FROM ride;

UPDATE bank_account
   SET balance_cents = 50000
 WHERE owner_type   = 'rider';

UPDATE bank_account
   SET balance_cents = 0
 WHERE owner_type   = 'driver';

UPDATE bank_account
   SET balance_cents = 0
 WHERE owner_type   = 'company';

COMMIT;


-- TRANSACTION 4: Admin truncate payments
-- Used by /api/admin/truncate with table='payment'

BEGIN;

DELETE FROM payment;

COMMIT;

-- TRANSACTION 5: Update location hot-area flag + effective commission
-- Used by /api/location/hot-area (update)
--
-- Parameters:
--   $1 = location_id
--   $2 = is_hot_area (boolean)
--   $3 = commission_discount_pct

BEGIN;

WITH updated AS (
  UPDATE location
     SET is_hot_area = $2,
         commission_discount_pct = ROUND($3::numeric, 2)
   WHERE location_id = $1
   RETURNING location_id, name, is_hot_area, commission_discount_pct
),
base AS (
  SELECT COALESCE(
    (SELECT default_pct FROM deduction_type WHERE name = 'company_commission'),
    20.00
  ) AS base_commission
)
SELECT
  u.location_id,
  u.name,
  u.is_hot_area,
  u.commission_discount_pct,
  GREATEST(0, LEAST(100, b.base_commission - u.commission_discount_pct))::numeric(6,2)
    AS eff_commission_pct
FROM updated u
CROSS JOIN base b;

COMMIT;


-- TRANSACTION 6: Set deduction types (upsert)
-- Used by /api/deductions with op='set'
--
-- Parameters:
--   For each deduction:
--     $1 = name
--     $2 = default_pct

INSERT INTO deduction_type (name, default_pct)
VALUES ($1, $2)
ON CONFLICT (name)
DO UPDATE
   SET default_pct = EXCLUDED.default_pct;


-- TRANSACTION 7: Driver goes online/offline
-- Used by /api/driver/availability 
--
-- Parameters:
--   $1 = driver_id
--   $2 = is_online (boolean)

BEGIN;

UPDATE driver
   SET is_online   = $2,
       last_seen_at = NOW()
 WHERE driver_id = $1
 RETURNING is_online, last_seen_at;

COMMIT;


-- TRANSACTION 8: Driver rejects ride
-- Used by /api/driver/reject
--
-- Parameters:
--   $1 = ride_id
--   $2 = driver_id

BEGIN;

UPDATE ride
   SET status = 'canceled'
 WHERE ride_id = $1
   AND driver_id = $2
   AND status = 'requested'
 RETURNING ride_id;

COMMIT;



--------------------------- QUERIES ---------------------------

-- 1. Admin: Simple browse example (for any table)
-- Used conceptually by /api/admin/browse
-- Example for ride table:
SELECT *
FROM ride
ORDER BY 1
LIMIT 10;


-- 2. Location commission summary (effective commission %)
-- Used by /api/location/hot-area/list
WITH base AS (
  SELECT COALESCE(
    (SELECT default_pct FROM deduction_type WHERE name = 'company_commission'),
    20.00
  ) AS base_commission
)
SELECT
  l.location_id,
  l.name,
  l.is_hot_area,
  l.commission_discount_pct,
  GREATEST(0, LEAST(100, b.base_commission - l.commission_discount_pct))::numeric(6,2)
    AS eff_commission_pct
FROM location l
CROSS JOIN base b
ORDER BY l.name;

-- 3. Company-level stats (totals)
-- Used by /api/company/stats
SELECT
  COUNT(*)::int AS total_rides,
  COALESCE(SUM(company_commission_cents + rider_fee_cents + driver_deduction_cents),0)::bigint
    AS company_earnings_cents,
  COALESCE(SUM(driver_payout_cents),0)::bigint AS driver_payouts_cents,
  COALESCE(SUM(tax_cents),0)::bigint          AS tax_collected_cents
FROM ride
WHERE status IN ('accepted','ongoing','completed');


-- 4. Company insights – top routes, drivers, riders
-- Used by /api/company/reports

-- 4.1 Top revenue routes
SELECT
  lo.name AS origin,
  ld.name AS dest,
  COUNT(*)::int AS rides,
  COALESCE(SUM(r.fare_total_cents),0)::bigint AS revenue_cents
FROM ride r
JOIN location lo ON lo.location_id = r.origin_location_id
JOIN location ld ON ld.location_id = r.dest_location_id
WHERE r.status IN ('accepted','ongoing','completed')
GROUP BY lo.name, ld.name
ORDER BY revenue_cents DESC
LIMIT 10;


-- 4.2 Top drivers by payout
SELECT
  d.driver_id,
  d.name AS driver_name,
  COALESCE(SUM(r.driver_payout_cents),0)::bigint AS payout_cents
FROM ride r
JOIN driver d ON d.driver_id = r.driver_id
WHERE r.status IN ('accepted','ongoing','completed')
GROUP BY d.driver_id, d.name
ORDER BY payout_cents DESC
LIMIT 10;


-- 4.3 Top riders by spend
SELECT
  ri.rider_id,
  ri.name AS rider_name,
  COALESCE(SUM(r.fare_total_cents),0)::bigint AS spend_cents
FROM ride r
JOIN rider ri ON ri.rider_id = r.rider_id
WHERE r.status IN ('accepted','ongoing','completed')
GROUP BY ri.rider_id, ri.name
ORDER BY spend_cents DESC
LIMIT 10;


-- 5. Deduction types lookup
SELECT
  deduction_type_id,
  name,
  default_pct
FROM deduction_type
ORDER BY name;


-- 6. Driver history list (driver earnings per ride)
-- Used by /api/driver/history
--
-- Parameters:
--   $1 = driver_id
--   $2 = limit
SELECT
  r.ride_id,
  r.requested_at,
  lo.name  AS origin_name,
  ld.name  AS dest_name,
  c.name   AS category_name,
  r.status,
  CAST(r.distance_miles AS double precision) AS distance_miles,
  r.fare_total_cents,
  r.driver_payout_cents
FROM ride r
JOIN location lo ON lo.location_id = r.origin_location_id
JOIN location ld ON ld.location_id = r.dest_location_id
JOIN category c  ON c.category_id  = r.category_id
WHERE r.driver_id = $1
ORDER BY r.requested_at DESC
LIMIT $2;


-- 7. Driver glance
-- Used by /api/driver/list when driver_id is provided
--
-- Parameters:
--   $1 = driver_id

WITH me AS (
  SELECT current_latitude AS lat, current_longitude AS lng, is_online
  FROM driver
  WHERE driver_id = $1
),
area AS (
  SELECT l.name
  FROM location l, me
  ORDER BY ((l.latitude - me.lat)^2 + (l.longitude - me.lng)^2)
  LIMIT 1
),
today AS (
  SELECT
    COALESCE(SUM(driver_payout_cents),0) AS cents,
    COUNT(*) FILTER (WHERE status IN ('accepted','ongoing','completed')) AS rides_done
  FROM ride
  WHERE driver_id = $1
    AND DATE(requested_at) = CURRENT_DATE
),
wallet AS (
  SELECT balance_cents
  FROM bank_account
  WHERE owner_type = 'driver' AND driver_id = $1
)
SELECT
  (SELECT name          FROM area)  AS current_area,
  COALESCE((SELECT balance_cents   FROM wallet), 0) AS wallet_cents,
  (SELECT cents                     FROM today) AS earnings_today_cents,
  (SELECT rides_done                FROM today) AS rides_completed_today,
  (SELECT is_online                 FROM me)    AS is_online;


-- 8. Driver list
SELECT
  driver_id,
  name,
  email,
  is_online,
  current_latitude,
  current_longitude
FROM driver
ORDER BY name;

-- 9. Pending ride details for a driver
-- Parameters:
--   $1 = driver_id

SELECT
  r.ride_id,
  ri.name     AS rider_name,
  lo.name     AS origin_name,
  ld.name     AS dest_name,
  c.name      AS category_name,
  r.distance_miles::float8                       AS distance_miles,
  r.rate_cents_per_mile_applied,
  r.fare_base_cents,
  r.rider_fee_cents,
  r.tax_cents,
  r.fare_total_cents,
  r.rider_fee_pct_applied,
  r.tax_pct_applied,
  r.company_commission_cents,
  r.driver_deduction_cents,
  r.company_commission_pct_applied,
  r.driver_deduction_pct_applied,
  r.driver_payout_cents
FROM ride r
JOIN rider    ri ON ri.rider_id = r.rider_id
JOIN location lo ON lo.location_id = r.origin_location_id
JOIN location ld ON ld.location_id = r.dest_location_id
JOIN category c  ON c.category_id = r.category_id
WHERE r.driver_id = $1
  AND r.status = 'requested'
ORDER BY r.requested_at DESC
LIMIT 1;

-- 10. Rider metadata lists (riders, locations, categories)
-- Used by /api/meta

-- Riders
SELECT rider_id, name, email
FROM rider
ORDER BY name;

-- Locations
SELECT location_id, name, is_hot_area
FROM location
ORDER BY name;

-- Categories
SELECT category_id, name, rate_cents_per_mile
FROM category
ORDER BY category_id;


-- 11. Nearest online driver to a given origin location
-- Used by /api/driver/nearest-driver
--
-- Parameters:
--   $1 = origin_location_id

WITH pick AS (
  SELECT latitude AS plat, longitude AS plng
  FROM location WHERE location_id = $1
)
SELECT
  d.driver_id,
  d.name,
  d.email,
  d.is_online,
  d.last_seen_at,
  2 * 3958.7613 * ASIN(
    SQRT(
      POWER(SIN(RADIANS(d.current_latitude  - p.plat) / 2), 2) +
      COS(RADIANS(p.plat)) * COS(RADIANS(d.current_latitude)) *
      POWER(SIN(RADIANS(d.current_longitude - p.plng) / 2), 2)
    )
  ) AS distance_miles,
  loc2.name AS driver_area
FROM driver d
CROSS JOIN pick p
LEFT JOIN LATERAL (
  SELECT name
  FROM location x
  ORDER BY ((x.latitude - d.current_latitude)^2 + (x.longitude - d.current_longitude)^2)
  LIMIT 1
) loc2 ON true
WHERE d.is_online = TRUE
  AND d.current_latitude  IS NOT NULL
  AND d.current_longitude IS NOT NULL
ORDER BY distance_miles NULLS LAST
LIMIT 1;


-- 12. Fare quote computation (no write, only SELECT)
-- Used by /api/quote
--
-- Parameters:
--   $1 = origin_location_id
--   $2 = dest_location_id
--   $3 = category_id
WITH ded AS (
  SELECT
    COALESCE(
      (SELECT default_pct FROM deduction_type WHERE name = 'company_commission' LIMIT 1),
      20.00
    ) AS company_commission_pct,
    COALESCE(
      (SELECT default_pct FROM deduction_type WHERE name = 'rider_fee' LIMIT 1),
      3.00
    ) AS rider_fee_pct,
    COALESCE(
      (SELECT default_pct FROM deduction_type WHERE lower(name) LIKE '%driver%deduction%' ORDER BY deduction_type_id LIMIT 1),
      5.00
    ) AS driver_deduction_pct,
    COALESCE(
      (SELECT default_pct FROM deduction_type WHERE name = 'tax' LIMIT 1),
      8.25
    ) AS tax_pct
),
loc AS (
  SELECT
    lo.location_id AS origin_id, lo.latitude AS plat, lo.longitude AS plng,
    ld.location_id AS dest_id,   ld.latitude AS dlat, ld.longitude AS dlng,
    lo.is_hot_area AS o_hot, lo.commission_discount_pct AS o_disc,
    ld.is_hot_area AS d_hot, ld.commission_discount_pct AS d_disc
  FROM location lo, location ld
  WHERE lo.location_id = $1 AND ld.location_id = $2
),
dist AS (
  SELECT
    2 * 3958.7613 * ASIN(
      SQRT(
        POWER(SIN(RADIANS(l.dlat - l.plat) / 2), 2) +
        COS(RADIANS(l.plat)) * COS(RADIANS(l.dlat)) *
        POWER(SIN(RADIANS(l.dlng - l.plng) / 2), 2)
      )
    ) AS distance_miles,
    (l.o_hot OR l.d_hot) AS hot_area,
    (COALESCE(l.o_disc,0) + COALESCE(l.d_disc,0))/2.0 AS avg_discount
  FROM loc l
),
rate AS (
  SELECT
    COALESCE(fr.route_rate_cents_per_mile, c.rate_cents_per_mile) AS rate_cents_per_mile_applied
  FROM category c
  LEFT JOIN fare_rule fr
    ON fr.category_id = c.category_id
   AND fr.origin_location_id = $1
   AND fr.dest_location_id   = $2
  WHERE c.category_id = $3
),
applied AS (
  SELECT
    r.rate_cents_per_mile_applied,
    GREATEST(0, LEAST(100, d.company_commission_pct - ds.avg_discount)) AS company_commission_pct_applied,
    d.rider_fee_pct          AS rider_fee_pct_applied,
    d.driver_deduction_pct   AS driver_deduction_pct_applied,
    d.tax_pct                AS tax_pct_applied,
    ds.distance_miles,
    ds.hot_area
  FROM rate r, ded d, dist ds
),
priced AS (
  SELECT
    distance_miles,
    hot_area,
    rate_cents_per_mile_applied,
    company_commission_pct_applied,
    rider_fee_pct_applied,
    driver_deduction_pct_applied,
    tax_pct_applied,
    ROUND(distance_miles * rate_cents_per_mile_applied) AS fare_base_cents
  FROM applied
),
parts AS (
  SELECT
    p.*,
    ROUND(p.fare_base_cents * p.rider_fee_pct_applied / 100.0) AS rider_fee_cents,
    ROUND(
      (p.fare_base_cents + ROUND(p.fare_base_cents * p.rider_fee_pct_applied / 100.0))
      * p.tax_pct_applied / 100.0
    ) AS tax_cents
  FROM priced p
),
split AS (
  SELECT
    x.*,
    ROUND(x.fare_base_cents * x.company_commission_pct_applied / 100.0) AS company_commission_cents,
    ROUND(
      (x.fare_base_cents - ROUND(x.fare_base_cents * x.company_commission_pct_applied / 100.0))
      * x.driver_deduction_pct_applied / 100.0
    ) AS driver_deduction_cents
  FROM parts x
)
SELECT
  s.distance_miles,
  s.hot_area,
  jsonb_build_object(
    'fare_base_cents',             s.fare_base_cents,
    'rider_fee_cents',             s.rider_fee_cents,
    'tax_cents',                   s.tax_cents,
    'fare_total_cents',            (s.fare_base_cents + s.rider_fee_cents + s.tax_cents),
    'company_commission_cents',    s.company_commission_cents,
    'driver_deduction_cents',      s.driver_deduction_cents,
    'driver_payout_cents',         (s.fare_base_cents - s.company_commission_cents - s.driver_deduction_cents),
    'company_commission_pct_applied', s.company_commission_pct_applied,
    'rider_fee_pct_applied',          s.rider_fee_pct_applied,
    'driver_deduction_pct_applied',   s.driver_deduction_pct_applied,
    'tax_pct_applied',                s.tax_pct_applied,
    'rate_cents_per_mile_applied',    s.rate_cents_per_mile_applied
  ) AS breakdown
FROM split s;


-- 13. Rider history + wallet balance
-- Used by /api/rider/history
--
-- Parameters:
--   $1 = rider_id
--   $2 = limit

-- 13.1 Ride list
SELECT
  r.ride_id,
  r.requested_at,
  r.start_time,
  r.status,
  c.name          AS category_name,
  lo.name         AS origin_name,
  ld.name         AS dest_name,
  d.name          AS driver_name,
  r.distance_miles::float8 AS distance_miles,
  r.fare_total_cents,
  r.driver_payout_cents,
  COALESCE(p.method, NULL) AS payment_method
FROM ride r
JOIN location lo ON lo.location_id = r.origin_location_id
JOIN location ld ON ld.location_id = r.dest_location_id
JOIN category c  ON c.category_id  = r.category_id
JOIN driver  d   ON d.driver_id    = r.driver_id
LEFT JOIN payment p
  ON p.ride_id = r.ride_id
WHERE r.rider_id = $1
ORDER BY r.requested_at DESC
LIMIT $2;

-- 13.2 Rider wallet balance
SELECT balance_cents
FROM bank_account
WHERE owner_type = 'rider'
  AND rider_id   = $1
LIMIT 1;