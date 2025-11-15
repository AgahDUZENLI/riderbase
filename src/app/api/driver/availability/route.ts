import { NextResponse } from 'next/server'
import { Pool } from 'pg'
type Db = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg, driver_id, is_online } =
    await req.json() as { cfg: Db, driver_id: number, is_online: boolean }

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

    const q = await client.query(
      `UPDATE driver
         SET is_online   = $2,
             last_seen_at = NOW()
       WHERE driver_id = $1
       RETURNING is_online, last_seen_at`,
      [driver_id, is_online]
    )

    if (!q.rowCount) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
    }

    await client.query('COMMIT')

    const row = q.rows[0]
    return NextResponse.json({
      ok: true,
      is_online: row.is_online,
      last_seen_at: row.last_seen_at,
    })
  } catch (e:any) {
    if (client) {
      await client.query('ROLLBACK').catch(()=>{})
    }
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    if (client) client.release()
    await pool.end().catch(()=>{})
  }
}
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const driver_id = Number(url.searchParams.get('driver_id'))
    const host = url.searchParams.get('host')!, port = Number(url.searchParams.get('port')!)
    const database = url.searchParams.get('database')!, user = url.searchParams.get('user')!, password = url.searchParams.get('password')!

    const pool = new Pool({ host, port, database, user, password })
    const q = await pool.query(
      `SELECT is_online, last_seen_at FROM driver WHERE driver_id = $1`,
      [driver_id]
    )
    if (!q.rowCount) return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
    return NextResponse.json(q.rows[0])
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}