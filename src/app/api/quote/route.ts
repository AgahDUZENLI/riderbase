import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type DbCfg = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const body = await req.json()
  const { cfg, rider_id, origin_location_id, dest_location_id, category_id } = body as {
    cfg: DbCfg, rider_id: number, origin_location_id: number, dest_location_id: number, category_id: number
  }

  const pool = new Pool({
    host: cfg.host, port: Number(cfg.port), database: cfg.database, user: cfg.user, password: cfg.password,
    max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000,
  })

  const sql = `
WITH cfg AS (
  SELECT tax_pct, company_commission_pct, rider_fee_pct, driver_deduction_pct FROM settings WHERE settings_id = 1
),
loc AS (
  SELECT
    lo.location_id AS origin_id, lo.latitude AS plat, lo.longitude AS plng, lo.is_hot_area AS o_hot, lo.commission_discount_pct AS o_disc,
    ld.location_id AS dest_id,   ld.latitude AS dlat, ld.longitude AS dlng, ld.is_hot_area AS d_hot, ld.commission_discount_pct AS d_disc
  FROM location lo, location ld
  WHERE lo.location_id = $1 AND ld.location_id = $2
),
dist AS (
  -- Haversine (miles)
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
    GREATEST(0, LEAST(100, s.company_commission_pct - d.avg_discount)) AS company_commission_pct_applied,
    s.rider_fee_pct AS rider_fee_pct_applied,
    s.driver_deduction_pct AS driver_deduction_pct_applied,
    s.tax_pct AS tax_pct_applied,
    d.distance_miles, d.hot_area
  FROM rate r, cfg s, dist d
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
    ROUND( (p.fare_base_cents + ROUND(p.fare_base_cents * p.rider_fee_pct_applied / 100.0))
           * p.tax_pct_applied / 100.0) AS tax_cents
  FROM priced p
),
split AS (
  SELECT
    x.*,
    ROUND(x.fare_base_cents * x.company_commission_pct_applied / 100.0) AS company_commission_cents,
    ROUND((x.fare_base_cents - ROUND(x.fare_base_cents * x.company_commission_pct_applied / 100.0))
          * x.driver_deduction_pct_applied / 100.0) AS driver_deduction_cents
  FROM parts x
)
SELECT
  distance_miles,
  hot_area,
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
FROM split;
  `

  try {
    const { rows } = await pool.query(sql, [origin_location_id, dest_location_id, category_id])
    if (!rows.length) return NextResponse.json({ error: 'Could not compute quote' }, { status: 400 })
    const r = rows[0]
    return NextResponse.json({
      distance_miles: Number(r.distance_miles),
      hot_area: r.hot_area,
      breakdown: {
        fare_base_cents: Number(r.fare_base_cents),
        rider_fee_cents: Number(r.rider_fee_cents),
        tax_cents: Number(r.tax_cents),
        fare_total_cents: Number(r.fare_total_cents),
        company_commission_cents: Number(r.company_commission_cents),
        driver_deduction_cents: Number(r.driver_deduction_cents),
        driver_payout_cents: Number(r.driver_payout_cents),
        company_commission_pct_applied: Number(r.company_commission_pct_applied),
        rider_fee_pct_applied: Number(r.rider_fee_pct_applied),
        driver_deduction_pct_applied: Number(r.driver_deduction_pct_applied),
        tax_pct_applied: Number(r.tax_pct_applied),
        rate_cents_per_mile_applied: Number(r.rate_cents_per_mile_applied),
      },
    })
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await pool.end().catch(()=>{})
  }
}