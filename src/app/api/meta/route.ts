import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type DbCfg = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg } = await req.json() as { cfg: DbCfg }
  const pool = new Pool({
    host: cfg.host, port: Number(cfg.port), database: cfg.database, user: cfg.user, password: cfg.password,
    max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000,
  })
  try {
    const [riders, locs, cats] = await Promise.all([
      pool.query('SELECT rider_id, name, email FROM rider ORDER BY name'),
      pool.query('SELECT location_id, name, is_hot_area FROM location ORDER BY name'),
      pool.query('SELECT category_id, name, rate_cents_per_mile FROM category ORDER BY category_id'),
    ])
    return NextResponse.json({
      riders: riders.rows,
      locations: locs.rows,
      categories: cats.rows,
    })
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally { await pool.end().catch(()=>{}) }
}