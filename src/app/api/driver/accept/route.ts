import { NextResponse } from 'next/server'
import { Pool } from 'pg'
type Db = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg, driver_id, ride_id } = await req.json() as { cfg: Db, driver_id: number, ride_id: number }

  const pool = new Pool({
    host: cfg.host, port: Number(cfg.port), database: cfg.database,
    user: cfg.user, password: cfg.password,
  })

  try {
    const upd = await pool.query(
      `UPDATE ride
         SET status='accepted', start_time = NOW()
       WHERE ride_id = $1 AND driver_id = $2 AND status='requested'
       RETURNING ride_id`,
      [ride_id, driver_id]
    )
    if (!upd.rowCount) return NextResponse.json({ error: 'Ride not found or already accepted' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await pool.end().catch(()=>{})
  }
}