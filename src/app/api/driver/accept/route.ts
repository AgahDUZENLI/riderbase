import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type Db = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg, driver_id, ride_id } = await req.json() as {
    cfg: Db
    driver_id: number
    ride_id: number
  }

  if (!cfg || !driver_id || !ride_id) {
    return NextResponse.json({ error: 'Missing cfg, driver_id or ride_id' }, { status: 400 })
  }

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
    await client.query('BEGIN')

    const sel = await client.query(
      `
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
      WHERE r.ride_id = $1
        AND r.driver_id = $2
        AND r.status = 'requested'
      FOR UPDATE
      `,
      [ride_id, driver_id]
    )

    if (!sel.rowCount) {
      await client.query('ROLLBACK')
      return NextResponse.json(
        { error: 'Ride not found, not assigned to this driver, or not in requested state' },
        { status: 400 }
      )
    }

    const row = sel.rows[0]
    const method: 'card' | 'wallet' = row.payment_method
    const fareTotal: number        = Number(row.fare_total_cents)
    const companyCommission: number = Number(row.company_commission_cents)
    const riderFee: number          = Number(row.rider_fee_cents)
    const driverDeduction: number   = Number(row.driver_deduction_cents)
    const driverPayout: number      = Number(row.driver_payout_cents)

    const companyCredit = companyCommission + riderFee + driverDeduction

    // If paying by wallet, charge the rider's in-app wallet NOW (on accept)
    if (method === 'wallet') {
      const debit = await client.query(
        `
        UPDATE bank_account
           SET balance_cents = balance_cents - $1
         WHERE owner_type = 'rider'
           AND rider_id   = $2
           AND balance_cents >= $1
        `,
        [fareTotal, row.rider_id]
      )

      if (!debit.rowCount) {
        await client.query('ROLLBACK')
        return NextResponse.json(
          { error: 'Insufficient wallet balance or missing rider account' },
          { status: 400 }
        )
      }
    }

    await client.query(
      `
      UPDATE bank_account
         SET balance_cents = balance_cents + $1
       WHERE owner_type = 'company'
      `,
      [companyCredit]
    )

    await client.query(
      `
      UPDATE bank_account
         SET balance_cents = balance_cents + $1
       WHERE owner_type = 'driver'
         AND driver_id  = $2
      `,
      [driverPayout, row.driver_id]
    )

    await client.query(
      `
      UPDATE ride
         SET status = 'accepted',
             start_time = NOW()
       WHERE ride_id = $1
      `,
      [ride_id]
    )

    await client.query('COMMIT')
    return NextResponse.json({ ok: true })
  } catch (e:any) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {})
    }
    return NextResponse.json({ error: e.message || 'Ride accept failed' }, { status: 500 })
  } finally {
    if (client) client.release()
    await pool.end().catch(() => {})
  }
}