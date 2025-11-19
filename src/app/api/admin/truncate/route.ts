import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type Db = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg, table } = await req.json() as {
    cfg: Db
    table: string
  }

  if (!cfg || !table) {
    return NextResponse.json({ error: 'Missing cfg or table' }, { status: 400 })
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

    if (table === 'ride') {
      await client.query(`DELETE FROM ride;`)


      // Reset bank balances
      await client.query(`
        UPDATE bank_account
        SET balance_cents = 50000
        WHERE owner_type = 'rider';
      `)

      // Drivers: reset to $0
      await client.query(`
        UPDATE bank_account
        SET balance_cents = 0
        WHERE owner_type = 'driver';
      `)

      // Company: reset to $0
      await client.query(`
        UPDATE bank_account
        SET balance_cents = 0
        WHERE owner_type = 'company';
      `)

      await client.query('COMMIT')
      return NextResponse.json({
        message: 'Rides cleared. Bank accounts reset to defaults.',
      })
    }

    if (table === 'payment') {
      await client.query(`DELETE FROM payment;`)
      await client.query('COMMIT')
      return NextResponse.json({ message: 'Payments cleared.' })
    }

    await client.query('ROLLBACK')
    return NextResponse.json({ error: 'Invalid table' }, { status: 400 })

  } catch (e:any) {
    if (client) await client.query('ROLLBACK').catch(()=>{})
    return NextResponse.json({ error: e.message || 'truncate failed' }, { status: 500 })
  } finally {
    if (client) client.release()
    await pool.end().catch(()=>{})
  }
}