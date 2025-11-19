import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type Db = { host:string; port:string; database:string; user:string; password:string }

export async function POST(req: Request) {
  const { cfg, table, limit } = await req.json() as {
    cfg: Db
    table: string
    limit?: number
  }

  if (!cfg || !table) {
    return NextResponse.json({ error: 'Missing cfg or table' }, { status: 400 })
  }

  const allowed = [
    'rider',
    'driver',
    'location',
    'category',
    'fare_rule',
    'ride',
    'payment',
    'deduction_type',
    'bank_account',
  ] as const

  if (!allowed.includes(table as any)) {
    return NextResponse.json({ error: 'Invalid table' }, { status: 400 })
  }

  const lim = Math.min(Math.max(limit ?? 10, 1), 50)

  const pool = new Pool({
    host: cfg.host,
    port: Number(cfg.port),
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
  })

  let client
  try {
    client = await pool.connect()
    const sql = `SELECT * FROM ${table} ORDER BY 1 LIMIT $1`
    const result = await client.query(sql, [lim])
    return NextResponse.json({ rows: result.rows })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'browse failed' }, { status: 500 })
  } finally {
    if (client) client.release()
    await pool.end().catch(() => {})
  }
}