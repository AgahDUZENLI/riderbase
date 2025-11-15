import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type Cfg = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg } = await req.json() as { cfg: Cfg }
  if (!cfg) return NextResponse.json({ error: 'Missing cfg' }, { status: 400 })

  const pool = new Pool({
    host: cfg.host, port: Number(cfg.port),
    database: cfg.database, user: cfg.user, password: cfg.password
  })

  const sql = `
    WITH base AS (
      SELECT COALESCE(
        (SELECT default_pct FROM deduction_type WHERE name = 'company_commission'),
        20.00
      ) AS base_commission
    )
    SELECT
      l.location_id,
      l.name,
      l.is_hot_area,
      l.commission_discount_pct,
      GREATEST(0, LEAST(100, b.base_commission - l.commission_discount_pct))::numeric(6,2) AS eff_commission_pct
    FROM location l
    CROSS JOIN base b
    ORDER BY l.name;
  `

  try {
    const { rows } = await pool.query(sql)
    return NextResponse.json({ rows })
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await pool.end().catch(()=>{})
  }
}