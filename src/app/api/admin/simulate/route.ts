import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type Db = { host:string; port:string; database:string; user:string; password:string }
type PaymentMethod = 'card' | 'wallet'

// simple helper to pick a random element
const pick = <T,>(arr: T[]): T =>
  arr[Math.floor(Math.random() * arr.length)]

export async function POST(req: Request) {
  const { cfg, count } = await req.json() as {
    cfg: Db
    count?: number
  }

  if (!cfg) {
    return NextResponse.json({ error: 'Missing cfg' }, { status: 400 })
  }

  const n = Math.min(Math.max(count ?? 50, 1), 200)

  const pool = new Pool({
    host: cfg.host,
    port: Number(cfg.port),
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
  })

  let client
  try {
    client = await pool.connect()

    const ridersRes  = await client.query('SELECT rider_id FROM rider')
    const driversRes = await client.query('SELECT driver_id FROM driver WHERE is_online = TRUE')
    const locsRes    = await client.query('SELECT location_id FROM location')
    const catsRes    = await client.query('SELECT category_id FROM category')

    const riders  = ridersRes.rows.map(r => Number(r.rider_id))
    const drivers = driversRes.rows.map(d => Number(d.driver_id))
    const locs    = locsRes.rows.map(l => Number(l.location_id))
    const cats    = catsRes.rows.map(c => Number(c.category_id))

    if (!riders.length || !drivers.length || !locs.length || !cats.length) {
      return NextResponse.json(
        { error: 'Need at least one rider, driver, location, and category before simulation.' },
        { status: 400 },
      )
    }

    const sqlInsertRide = `
      WITH ded AS (
        SELECT
          COALESCE((SELECT default_pct FROM deduction_type WHERE name = 'company_commission' LIMIT 1), 20.00) AS company_commission_pct,
          COALESCE((SELECT default_pct FROM deduction_type WHERE name = 'rider_fee'           LIMIT 1),  3.00) AS rider_fee_pct,
          COALESCE((SELECT default_pct FROM deduction_type WHERE name = 'driver_deduction'    LIMIT 1),  5.00) AS driver_deduction_pct,
          COALESCE((SELECT default_pct FROM deduction_type WHERE name = 'tax'                 LIMIT 1),  8.25) AS tax_pct
      ),
      cat AS (
        SELECT rate_cents_per_mile
        FROM category
        WHERE category_id = $3
      ),
      calc AS (
        SELECT
          (3 + random() * 15)::numeric(8,2)                AS distance_miles,
          c.rate_cents_per_mile                            AS rate_cents_per_mile_applied,
          d.company_commission_pct                         AS company_commission_pct_applied,
          d.rider_fee_pct                                  AS rider_fee_pct_applied,
          d.driver_deduction_pct                           AS driver_deduction_pct_applied,
          d.tax_pct                                        AS tax_pct_applied
        FROM ded d, cat c
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
        $1::bigint AS rider_id,
        $2::bigint AS driver_id,
        $3::int    AS category_id,
        $4::int    AS origin_location_id,
        $5::int    AS dest_location_id,
        NOW()      AS requested_at,
        calc.distance_miles,
        fare_base_cents,
        rider_fee_cents,
        tax_cents,
        (fare_base_cents + rider_fee_cents + tax_cents)                                      AS fare_total_cents,
        company_commission_cents,
        driver_deduction_cents,
        (fare_base_cents - company_commission_cents - driver_deduction_cents)                AS driver_payout_cents,
        calc.company_commission_pct_applied,
        calc.rider_fee_pct_applied,
        calc.driver_deduction_pct_applied,
        calc.tax_pct_applied,
        calc.rate_cents_per_mile_applied,
        'requested'
      FROM (
        SELECT
          calc.distance_miles,
          calc.rate_cents_per_mile_applied,
          calc.company_commission_pct_applied,
          calc.rider_fee_pct_applied,
          calc.driver_deduction_pct_applied,
          calc.tax_pct_applied,
          ROUND(calc.distance_miles * calc.rate_cents_per_mile_applied)                                  AS fare_base_cents,
          ROUND(ROUND(calc.distance_miles * calc.rate_cents_per_mile_applied) * calc.rider_fee_pct_applied / 100.0) AS rider_fee_cents,
          ROUND(
            (ROUND(calc.distance_miles * calc.rate_cents_per_mile_applied) +
             ROUND(ROUND(calc.distance_miles * calc.rate_cents_per_mile_applied) * calc.rider_fee_pct_applied / 100.0)
            ) * calc.tax_pct_applied / 100.0
          ) AS tax_cents,
          ROUND(ROUND(calc.distance_miles * calc.rate_cents_per_mile_applied) * calc.company_commission_pct_applied / 100.0) AS company_commission_cents,
          ROUND(
            (ROUND(calc.distance_miles * calc.rate_cents_per_mile_applied) -
             ROUND(ROUND(calc.distance_miles * calc.rate_cents_per_mile_applied) * calc.company_commission_pct_applied / 100.0)
            ) * calc.driver_deduction_pct_applied / 100.0
          ) AS driver_deduction_cents
        FROM calc
      ) AS calc
      RETURNING
        ride_id,
        rider_id,
        driver_id,
        fare_total_cents,
        company_commission_cents,
        rider_fee_cents,
        driver_deduction_cents,
        driver_payout_cents
    `

    let success = 0
    let failed  = 0

    for (let i = 0; i < n; i++) {
      try {
        await client.query('BEGIN')

        const rider_id  = pick(riders)
        const driver_id = pick(drivers)

        let origin_id = pick(locs)
        let dest_id   = pick(locs)
        if (locs.length > 1) {
          while (dest_id === origin_id) dest_id = pick(locs)
        }

        const category_id = pick(cats)
        const method: PaymentMethod = Math.random() < 0.5 ? 'wallet' : 'card'

        const ins = await client.query(sqlInsertRide, [
          rider_id,
          driver_id,
          category_id,
          origin_id,
          dest_id,
        ])

        if (!ins.rows.length) {
          await client.query('ROLLBACK')
          failed++
          continue
        }

        const row = ins.rows[0]
        const ride_id           = Number(row.ride_id)
        const fareTotal         = Number(row.fare_total_cents)
        const companyCommission = Number(row.company_commission_cents)
        const riderFee          = Number(row.rider_fee_cents)
        const driverDeduction   = Number(row.driver_deduction_cents)
        const driverPayout      = Number(row.driver_payout_cents)

        const companyCredit = companyCommission + riderFee + driverDeduction

        await client.query(
          `INSERT INTO payment (ride_id, method, amount_total_cents, status, paid_at)
           VALUES ($1, $2, $3, 'authorized', NOW())
           ON CONFLICT (ride_id, method) DO NOTHING`,
          [ride_id, method, fareTotal]
        )

        if (method === 'wallet') {
          const debit = await client.query(
            `UPDATE bank_account
               SET balance_cents = balance_cents - $1
             WHERE owner_type = 'rider'
               AND rider_id   = $2
               AND balance_cents >= $1`,
            [fareTotal, rider_id]
          )

          if (!debit.rowCount) {
            await client.query('ROLLBACK')
            failed++
            continue
          }
        }

        await client.query(
          `UPDATE bank_account
             SET balance_cents = balance_cents + $1
           WHERE owner_type = 'company'
             AND account_id = 1`,
          [companyCredit]
        )

        await client.query(
          `UPDATE bank_account
             SET balance_cents = balance_cents + $1
           WHERE owner_type = 'driver'
             AND driver_id  = $2`,
          [driverPayout, driver_id]
        )
        await client.query(
          `UPDATE ride
             SET status = 'accepted',
                 start_time = NOW()
           WHERE ride_id = $1`,
          [ride_id]
        )

        await client.query('COMMIT')
        success++
      } catch {
        await client.query('ROLLBACK').catch(() => {})
        failed++
      }
    }

    return NextResponse.json({
      message: `Simulated ${success} rides (${failed} failed, e.g. insufficient wallet).`,
    })
  } catch (e:any) {
    return NextResponse.json({ error: e.message || 'simulate failed' }, { status: 500 })
  } finally {
    if (client) client.release()
    await pool.end().catch(() => {})
  }
}