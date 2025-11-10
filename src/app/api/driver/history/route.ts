import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type Db = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg, driver_id } = await req.json() as { cfg: Db, driver_id: number }

  const pool = new Pool({
    host: cfg.host, port: Number(cfg.port), database: cfg.database,
    user: cfg.user, password: cfg.password,
    max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000,
  })

  const sql = `
SELECT
  r.ride_id,
  r.requested_at,
  lo.name AS origin_name,
  ld.name AS dest_name,
  c.name  AS category_name,
  r.fare_total_cents,
  r.driver_payout_cents,
  r.status
FROM ride r
JOIN location lo ON lo.location_id = r.origin_location_id
JOIN location ld ON ld.location_id = r.dest_location_id
JOIN category c  ON c.category_id  = r.category_id
WHERE r.driver_id = $1
ORDER BY r.requested_at DESC
LIMIT 10;
  `
  try {
    const { rows } = await pool.query(sql, [driver_id])
    return NextResponse.json({ rides: rows })
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await pool.end().catch(()=>{})
  }
}