import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type DbCfg = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg, origin_location_id } = await req.json() as {
    cfg: DbCfg, origin_location_id: number
  }

  const pool = new Pool({
    host: cfg.host, port: Number(cfg.port), database: cfg.database,
    user: cfg.user, password: cfg.password,
    max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000,
  })

  const sql = `
WITH pick AS (
  SELECT latitude AS plat, longitude AS plng
  FROM location WHERE location_id = $1
)
SELECT
  d.driver_id, d.name, d.email, d.is_online, d.last_seen_at,
  2 * 3958.7613 * ASIN(
    SQRT(
      POWER(SIN(RADIANS(d.current_latitude  - p.plat) / 2), 2) +
      COS(RADIANS(p.plat)) * COS(RADIANS(d.current_latitude)) *
      POWER(SIN(RADIANS(d.current_longitude - p.plng) / 2), 2)
    )
  ) AS distance_miles,
  loc2.name AS driver_area
FROM driver d
CROSS JOIN pick p
LEFT JOIN LATERAL (
  SELECT name
  FROM location x
  ORDER BY ((x.latitude - d.current_latitude)^2 + (x.longitude - d.current_longitude)^2)
  LIMIT 1
) loc2 ON true
WHERE d.is_online = TRUE
  AND d.current_latitude  IS NOT NULL
  AND d.current_longitude IS NOT NULL
ORDER BY distance_miles NULLS LAST
LIMIT 1;
  `

  try {
    const { rows } = await pool.query(sql, [origin_location_id])
    if (!rows.length) {
      return NextResponse.json({ error: 'No online drivers found' }, { status: 404 })
    }
    const r = rows[0] as any
    const distance = Number(r.distance_miles)
    const eta_min = Math.max(1, Math.round(distance * (60 / 18))) // ~18 mph city avg
    return NextResponse.json({
      driver_id: r.driver_id,
      name: r.name,
      email: r.email,
      is_online: r.is_online,
      last_seen_at: r.last_seen_at,
      distance_miles: distance,
      eta_min,
      driver_area: r.driver_area ?? null,
    })
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await pool.end().catch(()=>{})
  }
}