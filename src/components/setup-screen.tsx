'use client'
import { useEffect, useState } from 'react'

type DbConfig = {
  host: string
  port: string
  database: string
  user: string
  password: string
}

const LS_KEY = 'rb.db.config'

export default function SetupScreen() {
  const [cfg, setCfg] = useState<DbConfig>({
    host: '127.0.0.1',
    port: '5432',
    database: 'cosc3380',
    user: 'dbs006',
    password: 'wrMtSyoVp3xn',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  
  function update<K extends keyof DbConfig>(k: K, v: string) {
    const next = { ...cfg, [k]: v }
    setCfg(next)
    localStorage.setItem(LS_KEY, JSON.stringify(next))
  }

  async function setup() {
    if (!cfg.host || !cfg.port || !cfg.database || !cfg.user || !cfg.password) {
      setMsg('❌ Fill all fields.')
      return
    }
    setBusy(true); setMsg('⏳ Connecting & setting up…')
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Setup failed')
      setMsg(`✅ ${data.message || 'Database ready.'}`)
    } catch (e: any) {
      setMsg(`❌ ${e.message || 'Setup failed'}`)
    } finally { setBusy(false) }
  }

  return (
    <div className="max-w-md mx-auto rounded-xl border p-6">
      <h1 className="text-xl font-semibold">RiderBase Setup</h1>
      <p className="text-sm text-gray-600">Enter your local Postgres info.</p>

      <div className="mt-4 space-y-3">
        <Field label="Host" value={cfg.host} onChange={v => update('host', v)} />
        <Field label="Port" value={cfg.port} onChange={v => update('port', v)} />
        <Field label="Database" value={cfg.database} onChange={v => update('database', v)} />
        <Field label="User" value={cfg.user} onChange={v => update('user', v)} />
        <Field label="Password" type="password" value={cfg.password} onChange={v => update('password', v)} />
      </div>

      <button
        onClick={setup}
        disabled={busy}
        className="mt-4 w-full rounded-md bg-black px-4 py-2 text-white text-sm disabled:opacity-60"
      >
        {busy ? 'Working…' : 'Setup DB'}
      </button>

      {msg && <p className="mt-3 text-sm text-center">{msg}</p>}
    </div>
  )
}

function Field({
  label, value, onChange, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block text-sm">
      <span className="block text-gray-700 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-md border px-3 py-2"
      />
    </label>
  )
}