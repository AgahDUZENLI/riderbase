import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type Cfg = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg, range } = await req.json() as { cfg: Cfg, range:'7d'|'30d'|'all' }
  const pool = new Pool({ host:cfg.host, port:Number(cfg.port), database:cfg.database, user:cfg.user, password:cfg.password })
  const window =
    range==='7d'  ? "requested_at >= NOW() - INTERVAL '7 days'"
  : range==='30d' ? "requested_at >= NOW() - INTERVAL '30 days'"
  : 'TRUE'

  const sql = `
    SELECT
      COUNT(*)::int AS total_rides,
      COALESCE(SUM(company_commission_cents + rider_fee_cents + driver_deduction_cents),0)::bigint AS company_earnings_cents,
      COALESCE(SUM(driver_payout_cents),0)::bigint AS driver_payouts_cents,
      COALESCE(SUM(tax_cents),0)::bigint AS tax_collected_cents
    FROM ride
    WHERE ${window}
      AND status IN ('accepted','ongoing','completed')`
  try {
    const { rows } = await pool.query(sql)
    return NextResponse.json(rows[0])
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally { await pool.end().catch(()=>{}) }
}