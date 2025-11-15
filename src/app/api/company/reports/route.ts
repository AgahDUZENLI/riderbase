import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type Cfg = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg } = await req.json() as { cfg: Cfg }

  const pool = new Pool({
    host: cfg.host,
    port: Number(cfg.port),
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
  })

  try {
    const topRoutes = await pool.query(`
      SELECT
        lo.name AS origin,
        ld.name AS dest,
        COUNT(*)::int AS rides,
        COALESCE(SUM(r.fare_total_cents),0)::bigint AS revenue_cents
      FROM ride r
      JOIN location lo ON lo.location_id = r.origin_location_id
      JOIN location ld ON ld.location_id = r.dest_location_id
      WHERE r.status IN ('accepted','ongoing','completed')
      GROUP BY lo.name, ld.name
      ORDER BY revenue_cents DESC
      LIMIT 10;
    `)

    const topDrivers = await pool.query(`
      SELECT
        d.driver_id,
        d.name AS driver_name,
        COALESCE(SUM(r.driver_payout_cents),0)::bigint AS payout_cents
      FROM ride r
      JOIN driver d ON d.driver_id = r.driver_id
      WHERE r.status IN ('accepted','ongoing','completed')
      GROUP BY d.driver_id, d.name
      ORDER BY payout_cents DESC
      LIMIT 10;
    `)

    // Top Riders (highest spenders)
    const riderSpend = await pool.query(`
      SELECT
        ri.rider_id,
        ri.name AS rider_name,
        COALESCE(SUM(r.fare_total_cents),0)::bigint AS spend_cents
      FROM ride r
      JOIN rider ri ON ri.rider_id = r.rider_id
      WHERE r.status IN ('accepted','ongoing','completed')
      GROUP BY ri.rider_id, ri.name
      ORDER BY spend_cents DESC
      LIMIT 10;
    `)

    return NextResponse.json({
      top_routes: topRoutes.rows,
      top_drivers: topDrivers.rows,
      rider_spend: riderSpend.rows,
    })

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await pool.end().catch(() => {})
  }
}