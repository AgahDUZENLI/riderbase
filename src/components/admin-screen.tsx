'use client'
import { useState, useEffect } from 'react'

type DbCfg = { host:string; port:string; database:string; user:string; password:string }
const LS_KEY = 'rb.db.config'

const TABLES = [
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
type TableName = (typeof TABLES)[number]

export default function AdminScreen() {
  const [cfg, setCfg] = useState<DbCfg | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const [selectedTable, setSelectedTable] = useState<TableName>('rider')
  const [limit, setLimit] = useState<string>('10')
  const [rows, setRows] = useState<Record<string, any>[]>([])

  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) setCfg(JSON.parse(raw))
  }, [])

  async function call(path: string, body: any = {}) {
    if (!cfg) { setMsg('⚠️ Run Setup first.'); return }
    setBusy(true); setMsg('')
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cfg, ...body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setMsg(data.message || 'OK')
    } catch (e:any) {
      setMsg(`❌ ${e.message}`)
    } finally { setBusy(false) }
  }

  async function browse() {
    if (!cfg) { setMsg('⚠️ Run Setup first.'); return }
    setBusy(true); setMsg('')
    try {
      const lim = Number(limit) || 10
      const res = await fetch('/api/admin/browse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cfg, table: selectedTable, limit: lim }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Browse failed')
      setRows(data.rows || [])
      setMsg(`Showing up to ${lim} rows from "${selectedTable}"`)
    } catch (e:any) {
      setMsg(`❌ ${e.message}`)
      setRows([])
    } finally {
      setBusy(false)
    }
  }

  const hasRows = rows && rows.length > 0

  return (
    <div className="max-w-4xl mx-auto rounded-xl border p-6 space-y-6 bg-white">
      <h2 className="text-lg font-semibold">Admin / Debug</h2>

      {/* Simulation */}
      <div className="space-y-2">
        <div className="font-medium text-sm">Initialization</div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => call('/api/admin/simulate', { count: 50 })}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Simulate 50 rides
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="space-y-2">
        <div className="font-medium text-sm text-red-600">Danger zone</div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => call('/api/admin/truncate', { table: 'ride' })}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Clear rides
          </button>
          <button
            onClick={() => call('/api/admin/truncate', { table: 'payment' })}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Clear payments
          </button>
        </div>
      </div>

      {/* Browse tables – CLI-style output */}
      <div className="space-y-3">
        <div className="flex items-end gap-3">
          <div>
            <div className="font-medium text-sm mb-1">Browse table</div>
            <select
              className="rounded-md border px-3 py-1.5 text-sm"
              value={selectedTable}
              onChange={e => setSelectedTable(e.target.value as TableName)}
            >
              {TABLES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="font-medium text-sm mb-1">Limit</div>
            <input
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={e => setLimit(e.target.value)}
              className="w-20 rounded-md border px-2 py-1.5 text-sm"
            />
          </div>

          <button
            onClick={browse}
            disabled={busy || !cfg}
            className="ml-auto rounded-md border px-3 py-1.5 text-sm bg-gray-900 text-white disabled:opacity-60"
          >
            {busy ? 'Working…' : 'Browse'}
          </button>
        </div>

        <div className="mt-2 border rounded-md max-h-80 overflow-auto bg-black text-white">
          {!hasRows ? (
            <p className="p-3 text-xs text-gray-300">
              # No rows to display. Choose a table and click "Browse".
            </p>
          ) : (
            <pre className="p-3 text-xs font-mono whitespace-pre">
{rows.map((row, i) => `row[${i}]: ${JSON.stringify(row, null, 2)}`).join('\n\n')}
            </pre>
          )}
        </div>
      </div>

      {msg && <p className="text-sm mt-2">{msg}</p>}
    </div>
  )
}