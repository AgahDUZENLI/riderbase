import { NextResponse } from 'next/server'
import { Pool } from 'pg'
type Cfg = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg } = await req.json() as { cfg: Cfg }
  const pool = new Pool({ host:cfg.host, port:Number(cfg.port), database:cfg.database, user:cfg.user, password:cfg.password })
  try {
    const sql = `
      WITH base AS (SELECT (SELECT company_commission_pct FROM settings LIMIT 1) AS base_comm)
      SELECT l.location_id, l.name, l.is_hot_area, l.commission_discount_pct,
             GREATEST(0, (SELECT base_comm FROM base) - l.commission_discount_pct)::numeric AS eff_commission_pct
      FROM location l
      ORDER BY l.name`
    const { rows } = await pool.query(sql)
    return NextResponse.json({ rows })
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally { await pool.end().catch(()=>{}) }
}