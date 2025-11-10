import { NextResponse } from 'next/server'
import { Pool } from 'pg'
type Cfg = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg, location_id, is_hot_area, commission_discount_pct } =
    await req.json() as { cfg: Cfg, location_id:number, is_hot_area:boolean, commission_discount_pct:number }
  const pool = new Pool({ host:cfg.host, port:Number(cfg.port), database:cfg.database, user:cfg.user, password:cfg.password })
  try {
    await pool.query(
      `UPDATE location
         SET is_hot_area = $2, commission_discount_pct = $3
       WHERE location_id = $1`,
      [location_id, is_hot_area, commission_discount_pct]
    )
    return NextResponse.json({ ok:true })
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally { await pool.end().catch(()=>{}) }
}