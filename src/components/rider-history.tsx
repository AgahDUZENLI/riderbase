// src/components/rider-history.tsx
'use client'
import { useEffect, useMemo, useState } from 'react'

type DbCfg = { host:string; port:string; database:string; user:string; password:string }
const LS_KEY = 'rb.db.config'

type Rider = { rider_id:number; name:string; email:string }
type RideStatus = string;

type RideRow = {
  ride_id: number
  requested_at: string
  start_time: string | null
  end_time: string | null
  status: RideStatus
  category_name: string
  origin_name: string
  dest_name: string
  driver_name: string
  distance_miles: number | null
  fare_total_cents: number
  driver_payout_cents: number
}

export default function RiderHistory() {
  const [cfg, setCfg] = useState<DbCfg | null>(null)
  const [riders, setRiders] = useState<Rider[]>([])
  const [riderId, setRiderId] = useState<number | ''>('')
  const [rows, setRows] = useState<RideRow[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const nf2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const money = (c: number | null | undefined) => nf2.format(((c ?? 0) as number) / 100)
  const miles = (v: number | null | undefined) => (v == null ? '—' : `${nf2.format(v)}`)
  const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

  // load cfg and riders
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) { setMsg('⚠️ Run Setup and save DB config first.'); return }
    try {
      const parsed = JSON.parse(raw) as DbCfg
      setCfg(parsed)

      // reuse your /api/meta to get riders list
      fetch('/api/meta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cfg: parsed }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.error) throw new Error(data.error)
          setRiders(data.riders || [])
          if ((data.riders || []).length) setRiderId(data.riders[0].rider_id)
        })
        .catch(e => setMsg(`❌ ${e.message}`))
    } catch { /* ignore */ }
  }, [])

  const canLoad = useMemo(() => !!(cfg && riderId), [cfg, riderId])

  async function loadHistory() {
    if (!canLoad) return
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/rider/history', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cfg, rider_id: Number(riderId), limit: 50 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load history')
      setRows(data.rides || [])
    } catch (e:any) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  // auto-load when rider changes
  useEffect(() => { loadHistory().catch(()=>{}) }, [canLoad]) // eslint-disable-line

  return (
    <div className="rounded-2xl border p-6">
      <div className="mb-4 flex items-center gap-3">
        <h3 className="text-lg font-semibold">Ride History</h3>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm text-gray-600">Rider</label>
          <select
            className="rounded-md border px-3 py-2"
            value={riderId}
            onChange={e => setRiderId(Number(e.target.value))}
          >
            {riders.map(r => (
              <option key={r.rider_id} value={r.rider_id}>{r.name}</option>
            ))}
          </select>
          <button
            onClick={loadHistory}
            disabled={busy || !canLoad}
            className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">No rides yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2 pr-3">Ride #</th>
                <th className="py-2 pr-3">Requested</th>
                <th className="py-2 pr-3">From</th>
                <th className="py-2 pr-3">To</th>
                <th className="py-2 pr-3">Cat</th>
                <th className="py-2 pr-3">Driver</th>
                <th className="py-2 pr-3">Miles</th>
                <th className="py-2 pr-3">Total</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ride_id} className="border-t">
                  <td className="py-2 pr-3 font-medium">{r.ride_id}</td>
                  <td className="py-2 pr-3">{dateTime(r.requested_at)}</td>
                  <td className="py-2 pr-3">{r.origin_name}</td>
                  <td className="py-2 pr-3">{r.dest_name}</td>
                  <td className="py-2 pr-3">{r.category_name}</td>
                  <td className="py-2 pr-3">{r.driver_name}</td>
                  <td className="py-2 pr-3">{miles(r.distance_miles)}</td>
                  <td className="py-2 pr-3">${money(r.fare_total_cents)}</td>
                  <td className="py-2">
                    <span className="rounded-full px-2 py-0.5 text-xs border">{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}
    </div>
  )
}