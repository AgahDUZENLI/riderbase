// src/app/api/rides/create/route.ts
import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type DbCfg = { host:string; port:string; database:string; user:string; password:string }
type PaymentMethod = 'card' | 'wallet'

export async function POST(req: Request) {
  const body = await req.json()

  const {
    cfg,
    rider_id,
    driver_id,
    origin_location_id,
    dest_location_id,
    category_id,
    method,
  } = body as {
    cfg: DbCfg
    rider_id: number
    driver_id: number
    origin_location_id: number
    dest_location_id: number
    category_id: number
    method?: PaymentMethod
  }

  if (!cfg || !rider_id || !driver_id || !origin_location_id || !dest_location_id || !category_id) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  const pool = new Pool({
    host: cfg.host,
    port: Number(cfg.port),
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })

  const payMethod: PaymentMethod = method === 'wallet' ? 'wallet' : 'card'

  const sql = `
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
    RETURNING ride_id, fare_total_cents, driver_payout_cents;
  `

  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')

    // Insert ride
    const ins = await client.query(sql, [
      origin_location_id,
      dest_location_id,
      category_id,
      rider_id,
      driver_id,
    ])

    if (!ins.rows.length) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Could not insert ride' }, { status: 400 })
    }

    const ride = ins.rows[0]
    const ride_id: number = Number(ride.ride_id)
    const total_cents: number = Number(ride.fare_total_cents)

    //Insert payment
    await client.query(
      `INSERT INTO payment (ride_id, method, amount_total_cents, status, paid_at)
       VALUES ($1, $2, $3, 'authorized', NOW())
       ON CONFLICT (ride_id, method) DO NOTHING`,
      [ride_id, payMethod, total_cents]
    )

    await client.query('COMMIT')

    return NextResponse.json({ ok: true, ride_id, total_cents })
  } catch (e: any) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {})
    }
    return NextResponse.json({ error: e.message || 'Ride creation failed' }, { status: 500 })
  } finally {
    if (client) client.release()
    await pool.end().catch(() => {})
  }
}