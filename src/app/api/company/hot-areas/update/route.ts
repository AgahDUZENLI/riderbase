import { NextResponse } from 'next/server'
import { Pool } from 'pg'
type Cfg = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg, location_id, is_hot_area, commission_discount_pct } =
    await req.json() as { cfg: Cfg, location_id:number, is_hot_area:boolean, commission_discount_pct:number }

  if (!cfg || !location_id || typeof is_hot_area !== 'boolean') {
    return NextResponse.json({ error: 'Missing or invalid params' }, { status: 400 })
  }

  const disc = Math.max(0, Math.min(100, Number(commission_discount_pct ?? 0)))
  const pool = new Pool({
    host: cfg.host, port: Number(cfg.port),
    database: cfg.database, user: cfg.user, password: cfg.password
  })

  const sql = `
    WITH updated AS (
      UPDATE location
         SET is_hot_area = $2,
             commission_discount_pct = ROUND($3::numeric, 2)
       WHERE location_id = $1
       RETURNING location_id, name, is_hot_area, commission_discount_pct
    ),
    base AS (
      SELECT COALESCE(
        (SELECT default_pct FROM deduction_type WHERE name = 'Company Commission'),
        20.00
      ) AS base_commission
    )
    SELECT
      u.location_id,
      u.name,
      u.is_hot_area,
      u.commission_discount_pct,
      GREATEST(0, LEAST(100, b.base_commission - u.commission_discount_pct))::numeric(6,2) AS eff_commission_pct
    FROM updated u
    CROSS JOIN base b;
  `

  try {
    const { rows } = await pool.query(sql, [location_id, is_hot_area, disc])
    if (!rows.length) return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    return NextResponse.json({ ok:true, row: rows[0] })
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await pool.end().catch(()=>{})
  }
}