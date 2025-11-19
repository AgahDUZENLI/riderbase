-- ---------- LOCATIONS (with coordinates) ----------
INSERT INTO location (name, is_hot_area, commission_discount_pct, latitude, longitude)
SELECT 'Downtown', TRUE, 5.00, 29.7604, -95.3698
WHERE NOT EXISTS (SELECT 1 FROM location WHERE name='Downtown');

INSERT INTO location (name, is_hot_area, commission_discount_pct, latitude, longitude)
SELECT 'Midtown', FALSE, 0.00, 29.7419, -95.3780
WHERE NOT EXISTS (SELECT 1 FROM location WHERE name='Midtown');

INSERT INTO location (name, is_hot_area, commission_discount_pct, latitude, longitude)
SELECT 'Uptown', FALSE, 0.00, 29.7488, -95.4623
WHERE NOT EXISTS (SELECT 1 FROM location WHERE name='Uptown');

INSERT INTO location (name, is_hot_area, commission_discount_pct, latitude, longitude)
SELECT 'Museum District', FALSE, 0.00, 29.7216, -95.3895
WHERE NOT EXISTS (SELECT 1 FROM location WHERE name='Museum District');

INSERT INTO location (name, is_hot_area, commission_discount_pct, latitude, longitude)
SELECT 'Medical Center', TRUE, 3.00, 29.7046, -95.4018
WHERE NOT EXISTS (SELECT 1 FROM location WHERE name='Medical Center');

INSERT INTO location (name, is_hot_area, commission_discount_pct, latitude, longitude)
SELECT 'Heights', FALSE, 0.00, 29.7989, -95.3977
WHERE NOT EXISTS (SELECT 1 FROM location WHERE name='Heights');

INSERT INTO location (name, is_hot_area, commission_discount_pct, latitude, longitude)
SELECT 'Montrose', FALSE, 0.00, 29.7448, -95.3925
WHERE NOT EXISTS (SELECT 1 FROM location WHERE name='Montrose');

INSERT INTO location (name, is_hot_area, commission_discount_pct, latitude, longitude)
SELECT 'Galleria', FALSE, 0.00, 29.7390, -95.4666
WHERE NOT EXISTS (SELECT 1 FROM location WHERE name='Galleria');

INSERT INTO location (name, is_hot_area, commission_discount_pct, latitude, longitude)
SELECT 'Chinatown', FALSE, 0.00, 29.7146, -95.5545
WHERE NOT EXISTS (SELECT 1 FROM location WHERE name='Chinatown');

INSERT INTO location (name, is_hot_area, commission_discount_pct, latitude, longitude)
SELECT 'Airport', TRUE, 7.50, 29.9902, -95.3368
WHERE NOT EXISTS (SELECT 1 FROM location WHERE name='Airport');

-- ---------- CATEGORIES ----------
INSERT INTO category (name, rate_cents_per_mile)
SELECT 'Economy', 150
WHERE NOT EXISTS (SELECT 1 FROM category WHERE name='Economy');

INSERT INTO category (name, rate_cents_per_mile)
SELECT 'XL', 250
WHERE NOT EXISTS (SELECT 1 FROM category WHERE name='XL');

INSERT INTO category (name, rate_cents_per_mile)
SELECT 'Premium', 400
WHERE NOT EXISTS (SELECT 1 FROM category WHERE name='Premium');

-- ---------- FARE RULES ----------
INSERT INTO fare_rule (category_id, origin_location_id, dest_location_id, route_rate_cents_per_mile)
SELECT c.category_id, lo.location_id, ld.location_id, 300
FROM category c, location lo, location ld
WHERE c.name='Premium' AND lo.name='Airport' AND ld.name='Downtown'
  AND NOT EXISTS (
    SELECT 1 FROM fare_rule f
    WHERE f.category_id=c.category_id
      AND f.origin_location_id=lo.location_id
      AND f.dest_location_id=ld.location_id
  );

INSERT INTO fare_rule (category_id, origin_location_id, dest_location_id, route_rate_cents_per_mile)
SELECT c.category_id, lo.location_id, ld.location_id, 180
FROM category c, location lo, location ld
WHERE c.name='Economy' AND lo.name='Downtown' AND ld.name='Galleria'
  AND NOT EXISTS (
    SELECT 1 FROM fare_rule f
    WHERE f.category_id=c.category_id
      AND f.origin_location_id=lo.location_id
      AND f.dest_location_id=ld.location_id
  );

-- ---------- DEDUCTION TYPES ----------
INSERT INTO deduction_type (name, default_pct)
SELECT 'company_commission', 25.00
WHERE NOT EXISTS (SELECT 1 FROM deduction_type WHERE name = 'company_commission');

INSERT INTO deduction_type (name, default_pct)
SELECT 'driver_deduction', 5.00
WHERE NOT EXISTS (SELECT 1 FROM deduction_type WHERE name = 'driver_deduction');

INSERT INTO deduction_type (name, default_pct)
SELECT 'app_maintenance', 5.00
WHERE NOT EXISTS (SELECT 1 FROM deduction_type WHERE name = 'app_maintenance');

INSERT INTO deduction_type (name, default_pct)
SELECT 'tax', 8.25
WHERE NOT EXISTS (SELECT 1 FROM deduction_type WHERE name = 'tax');

INSERT INTO deduction_type (name, default_pct)
SELECT 'rider_fee', 8.25
WHERE NOT EXISTS (SELECT 1 FROM deduction_type WHERE name = 'rider_fee');



-- ---------- RIDERS ----------
INSERT INTO rider (name, email)
SELECT 'Alice Rider', 'alice@example.com'
WHERE NOT EXISTS (SELECT 1 FROM rider WHERE email='alice@example.com');

INSERT INTO rider (name, email)
SELECT 'Bob Traveler', 'bob@example.com'
WHERE NOT EXISTS (SELECT 1 FROM rider WHERE email='bob@example.com');

INSERT INTO rider (name, email)
SELECT 'Charlie Commuter', 'charlie@example.com'
WHERE NOT EXISTS (SELECT 1 FROM rider WHERE email='charlie@example.com');

-- ---------- DRIVERS ----------
INSERT INTO driver (name, email, current_latitude, current_longitude, is_online)
SELECT 'Dan Driver', 'dan@example.com', 29.7410, -95.3780, TRUE
WHERE NOT EXISTS (SELECT 1 FROM driver WHERE email='dan@example.com');

INSERT INTO driver (name, email, current_latitude, current_longitude, is_online)
SELECT 'Eve Chauffeur', 'eve@example.com', 29.7989, -95.3977, TRUE
WHERE NOT EXISTS (SELECT 1 FROM driver WHERE email='eve@example.com');

INSERT INTO driver (name, email, current_latitude, current_longitude, is_online)
SELECT 'Frank Operator', 'frank@example.com', 29.7448, -95.3925, TRUE
WHERE NOT EXISTS (SELECT 1 FROM driver WHERE email='frank@example.com');


INSERT INTO bank_account (owner_type, rider_id, balance_cents)
SELECT 'rider', r.rider_id, 50000
FROM rider r
WHERE NOT EXISTS (
  SELECT 1 FROM bank_account b WHERE b.rider_id = r.rider_id
);

INSERT INTO bank_account (owner_type, driver_id, balance_cents)
SELECT 'driver', d.driver_id, 0
FROM driver d
WHERE NOT EXISTS (
  SELECT 1 FROM bank_account b WHERE b.driver_id = d.driver_id
);

INSERT INTO bank_account (owner_type, balance_cents)
SELECT 'company', 0
WHERE NOT EXISTS (
  SELECT 1 FROM bank_account b WHERE b.owner_type = 'company'
);