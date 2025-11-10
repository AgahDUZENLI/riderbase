import { NextResponse } from 'next/server'
import { Pool } from 'pg'
type Db = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg, driver_id } = await req.json() as { cfg: Db, driver_id: number }

  const pool = new Pool({
    host: cfg.host, port: Number(cfg.port), database: cfg.database,
    user: cfg.user, password: cfg.password,
  })

  const sql = `
SELECT
  r.ride_id,
  ri.name AS rider_name,
  lo.name AS origin_name,
  ld.name AS dest_name,
  c.name  AS category_name,
  r.distance_miles,
  r.driver_payout_cents
FROM ride r
JOIN rider   ri ON ri.rider_id = r.rider_id
JOIN location lo ON lo.location_id = r.origin_location_id
JOIN location ld ON ld.location_id = r.dest_location_id
JOIN category c  ON c.category_id  = r.category_id
WHERE r.driver_id = $1
  AND r.status = 'requested'
ORDER BY r.requested_at DESC
LIMIT 1;
  `
  try {
    const { rows } = await pool.query(sql, [driver_id])
    if (!rows.length) return NextResponse.json({ ride: null })
    return NextResponse.json({ ride: rows[0] })
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await pool.end().catch(()=>{})
  }
}