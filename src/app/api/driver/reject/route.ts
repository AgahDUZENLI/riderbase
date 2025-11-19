import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type Db = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg, driver_id, ride_id } =
    await req.json() as { cfg: Db, driver_id: number, ride_id: number }

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

    const upd = await client.query(
      `UPDATE ride
         SET status = 'canceled'
       WHERE ride_id = $1
         AND driver_id = $2
         AND status = 'requested'
       RETURNING ride_id`,
      [ride_id, driver_id]
    )

    if (!upd.rowCount) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Ride not found or already handled' }, { status: 400 })
    }

    await client.query('COMMIT')
    return NextResponse.json({ ok: true })
  } catch (e:any) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {})
    }
    return NextResponse.json({ error: e.message || 'Reject failed' }, { status: 500 })
  } finally {
    if (client) client.release()
    await pool.end().catch(() => {})
  }
}