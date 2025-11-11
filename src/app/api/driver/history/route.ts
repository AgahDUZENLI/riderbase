// src/app/api/driver/history/route.ts
import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type Db = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { cfg, driver_id, limit = 10 } = body as { cfg: Db; driver_id: number; limit?: number }

  if (!cfg || !driver_id) {
    return NextResponse.json({ error: 'Missing cfg or driver_id' }, { status: 400 })
  }

  const pool = new Pool({
    host: cfg.host,
    port: Number(cfg.port),
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    max: 4,
    idleTimeoutMillis: 10_000,
  })

  const sql = `
    SELECT
      r.ride_id,
      r.requested_at,
      lo.name  AS origin_name,
      ld.name  AS dest_name,
      c.name   AS category_name,
      r.status,
      CAST(r.distance_miles AS double precision) AS distance_miles,
      r.fare_total_cents,
      r.driver_payout_cents
    FROM ride r
    JOIN location lo ON lo.location_id = r.origin_location_id
    JOIN location ld ON ld.location_id = r.dest_location_id
    JOIN category c  ON c.category_id  = r.category_id
    WHERE r.driver_id = $1
    ORDER BY r.requested_at DESC
    LIMIT $2;
  `

  try {
    const { rows } = await pool.query(sql, [driver_id, limit])
    return NextResponse.json({ rides: rows })
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await pool.end().catch(()=>{})
  }
}