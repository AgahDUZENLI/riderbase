// src/app/api/rider/history/route.ts
import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type Db = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { cfg, rider_id, limit = 50 } = body as { cfg: Db; rider_id: number; limit?: number }

  if (!cfg || !rider_id) {
    return NextResponse.json({ error: 'Missing cfg or rider_id' }, { status: 400 })
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
      r.start_time,
      r.end_time,
      r.status,
      c.name          AS category_name,
      lo.name         AS origin_name,
      ld.name         AS dest_name,
      d.name          AS driver_name,
      r.distance_miles::float8 AS distance_miles,
      r.fare_total_cents,
      r.driver_payout_cents,
      COALESCE(p.method, NULL) AS payment_method
    FROM ride r
    JOIN location lo ON lo.location_id = r.origin_location_id
    JOIN location ld ON ld.location_id = r.dest_location_id
    JOIN category c  ON c.category_id  = r.category_id
    JOIN driver  d   ON d.driver_id    = r.driver_id
    LEFT JOIN payment p
      ON p.ride_id = r.ride_id
    WHERE r.rider_id = $1
    ORDER BY r.requested_at DESC
    LIMIT $2;
  `

  try {
    const { rows } = await pool.query(sql, [rider_id, limit])
    return NextResponse.json({ rides: rows })
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await pool.end().catch(()=>{})
  }
}