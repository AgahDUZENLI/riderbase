import { NextResponse } from 'next/server'
import { Pool } from 'pg'

type Cfg = {
  host: string
  port: string
  database: string
  user: string
  password: string
}

type Deduction = { name: string; default_pct: number }

export async function POST(req: Request) {
  const { cfg, op, deduction_types } =
    await req.json() as { cfg: Cfg; op: 'get' | 'set'; deduction_types?: Deduction[] }

  if (!cfg) {
    return NextResponse.json({ error: 'Missing cfg' }, { status: 400 })
  }

  const pool = new Pool({
    host: cfg.host,
    port: Number(cfg.port),
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
  })

  try {
    if (op === 'get') {
      const { rows } = await pool.query(`
        SELECT deduction_type_id, name, default_pct
        FROM deduction_type
        ORDER BY name
      `)
      return NextResponse.json({ deduction_types: rows })
    }

    if (op === 'set') {
      const list = deduction_types ?? []
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        for (const d of list) {
          await client.query(
            `
            INSERT INTO deduction_type (name, default_pct)
            VALUES ($1, $2)
            ON CONFLICT (name)
            DO UPDATE SET default_pct = EXCLUDED.default_pct
            `,
            [d.name, Number(d.default_pct)]
          )
        }

        await client.query('COMMIT')
        return NextResponse.json({ ok: true })
      } catch (e: any) {
        await client.query('ROLLBACK').catch(() => {})
        return NextResponse.json({ error: e.message || 'Failed to update deduction types' }, { status: 500 })
      } finally {
        client.release()
      }
    }
    return NextResponse.json({ error: 'Invalid op' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
  } finally {
    await pool.end().catch(() => {})
  }
}