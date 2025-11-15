import { NextResponse } from 'next/server'
import { Pool } from 'pg'
import fs from 'node:fs/promises'
import path from 'node:path'

type DbConfig = {
  host: string; port: string; database: string; user: string; password: string;
}

function makePool(cfg: DbConfig) {
  return new Pool({
    host: cfg.host,
    port: Number(cfg.port),
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
}

async function runSQL(pool: Pool, relPath: string) {
  const filePath = path.resolve(process.cwd(), 'src', 'db', relPath)
  const sql = await fs.readFile(filePath, 'utf8')
  await pool.query(sql)
}

export async function POST(req: Request) {
  const cfg = (await req.json()) as DbConfig
  const pool = makePool(cfg)
  try {

    await pool.query('select 1')

    //schema + seed
    await runSQL(pool, 'schema.sql')
    await runSQL(pool, 'seed.sql')

    return NextResponse.json({ ok: true, message: 'Schema + seed done.' })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Setup failed' }, { status: 500 })
  } finally {
    await pool.end().catch(() => {})
  }
}