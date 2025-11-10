import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type Db = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg, driver_id } = await req.json() as { cfg: Db, driver_id?: number }

  const pool = new Pool({
    host: cfg.host, port: Number(cfg.port), database: cfg.database,
    user: cfg.user, password: cfg.password,
    max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000,
  })

  try {
    const drivers = (await pool.query(
      `SELECT driver_id, name, email, is_online, current_latitude, current_longitude
       FROM driver ORDER BY name`
    )).rows
    let glance: any = null
    if (driver_id) {
      const gsql = `
WITH me AS (
  SELECT current_latitude AS lat, current_longitude AS lng FROM driver WHERE driver_id = $1
),
area AS (
  SELECT l.name
  FROM location l, me
  ORDER BY ((l.latitude - me.lat)^2 + (l.longitude - me.lng)^2)
  LIMIT 1
),
today AS (
  SELECT
    COALESCE(SUM(driver_payout_cents),0) AS cents,
    COUNT(*) FILTER (WHERE status='completed') AS rides_done
  FROM ride
  WHERE driver_id = $1
    AND status IN ('accepted','ongoing','completed')
    AND start_time::date = CURRENT_DATE  
)
SELECT (SELECT name FROM area) AS current_area,
       (SELECT cents FROM today) AS earnings_today_cents,
       (SELECT rides_done FROM today) AS rides_completed_today;
      `
      const r = await pool.query(gsql, [driver_id])
      glance = r.rows[0] || null
    }

    return NextResponse.json({ drivers, glance })
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await pool.end().catch(()=>{})
  }
}