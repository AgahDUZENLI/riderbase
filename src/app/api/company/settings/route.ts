import { NextResponse } from 'next/server'
import { Pool } from 'pg'
type Cfg = { host:string; port:string; database:string; user:string; password:string }
type Settings = { settings_id:number; tax_pct:number; company_commission_pct:number; rider_fee_pct:number; driver_deduction_pct:number; team_number:number }

export async function POST(req: Request) {
  const { cfg, op, settings } = await req.json() as { cfg: Cfg, op:'get'|'set', settings?: Settings }
  const pool = new Pool({ host:cfg.host, port:Number(cfg.port), database:cfg.database, user:cfg.user, password:cfg.password })
  try {
    if (op === 'get') {
      const { rows } = await pool.query(`SELECT * FROM settings ORDER BY settings_id LIMIT 1`)
      return NextResponse.json({ settings: rows[0] })
    } else {
      const s = settings!
      await pool.query(
        `INSERT INTO settings (settings_id, tax_pct, company_commission_pct, rider_fee_pct, driver_deduction_pct, team_number)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (settings_id) DO UPDATE SET
           tax_pct=$2, company_commission_pct=$3, rider_fee_pct=$4, driver_deduction_pct=$5, team_number=$6`,
        [s.settings_id ?? 1, s.tax_pct, s.company_commission_pct, s.rider_fee_pct, s.driver_deduction_pct, s.team_number]
      )
      return NextResponse.json({ ok:true })
    }
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally { await pool.end().catch(()=>{}) }
}