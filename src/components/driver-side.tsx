'use client'
import { useEffect, useMemo, useState } from 'react'

type DbCfg = { host:string; port:string; database:string; user:string; password:string }
const LS_KEY = 'rb.db.config'

type Driver = {
  driver_id: number
  name: string
  email: string
  is_online: boolean
  current_latitude: number
  current_longitude: number
}

type RideReq = {
  ride_id: number
  rider_name: string
  origin_name: string
  dest_name: string
  category_name: string
  distance_miles: number | null

  rate_cents_per_mile_applied: number

  fare_base_cents: number
  rider_fee_cents: number
  tax_cents: number
  fare_total_cents: number
  rider_fee_pct_applied: number
  tax_pct_applied: number

  company_commission_cents: number
  driver_deduction_cents: number
  company_commission_pct_applied: number
  driver_deduction_pct_applied: number

  driver_payout_cents: number
}

type RideRow = {
  ride_id: number
  requested_at: string
  origin_name: string
  dest_name: string
  category_name: string
  fare_total_cents: number
  driver_payout_cents: number
  status: 'requested' | 'accepted' | 'canceled'
}

export default function DriverDashboard() {
  const [cfg, setCfg] = useState<DbCfg | null>(null)
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [driverId, setDriverId] = useState<number | ''>('')

  const [ride, setRide] = useState<RideReq | null>(null)
  const [currentArea, setCurrentArea] = useState<string>('')
  const [earnToday, setEarnToday] = useState<number>(0)
  const [ridesDone, setRidesDone] = useState<number>(0)
  const [isOnline, setIsOnline] = useState<boolean>(true)
  const [history, setHistory] = useState<RideRow[]>([])

  const [busy, setBusy] = useState(false)
  const [savingOnline, setSavingOnline] = useState(false)
  const [msg, setMsg] = useState('')

  const nf2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const money = (cents: number | null | undefined) => nf2.format(((cents ?? 0) as number) / 100)
  const miles = (v: number | null | undefined) => (v == null ? '—' : `${nf2.format(v)} mi`)
  const dateTime = (iso: string) => { try { return new Date(iso).toLocaleString() } catch { return iso } }

  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) { setMsg('⚠️ Run Setup first.'); return }
    const parsed = JSON.parse(raw) as DbCfg
    setCfg(parsed)
    fetch('/api/driver/meta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cfg: parsed }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setDrivers(data.drivers || [])
        if ((data.drivers || []).length) setDriverId(data.drivers[0].driver_id)
      })
      .catch(e => setMsg(`❌ ${e.message}`))
  }, [])

  async function refreshAll(selectedId: number) {
  if (!cfg) return

  // glance
  const meta = await fetch('/api/driver/meta', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cfg, driver_id: selectedId }),
  }).then(r => r.json()).catch(() => null)

if (meta && !meta.error && meta.glance) {
  setCurrentArea(meta.glance.current_area || '')

  setEarnToday(Number(meta.glance.wallet_cents || 0))

  setRidesDone(Number(meta.glance.rides_completed_today || 0))

  if (typeof meta.glance.is_online === 'boolean') {
    setIsOnline(meta.glance.is_online)
    setDrivers(ds =>
      ds.map(d =>
        d.driver_id === selectedId ? { ...d, is_online: meta.glance.is_online } : d
      )
    )
  }
}

  // queue
  const q = await fetch('/api/driver/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cfg, driver_id: selectedId }),
  }).then(r => r.json()).catch(() => null)
  setRide(q?.ride ?? null)

  // history
  const hist = await fetch('/api/driver/history', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cfg, driver_id: selectedId }),
  }).then(r => r.json()).catch(() => null)
  setHistory(hist?.rides ?? [])
}

  useEffect(() => {
    if (!cfg || !driverId) return
    refreshAll(Number(driverId)).catch(()=>{})
  }, [cfg, driverId]) 

  const canAccept = useMemo(() => !!(cfg && driverId && ride), [cfg, driverId, ride])
  const canReject = canAccept

  async function onAccept() {
    if (!canAccept || !ride) return
    try {
      setBusy(true); setMsg('')
      const res = await fetch('/api/driver/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cfg, driver_id: Number(driverId), ride_id: ride.ride_id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Accept failed')
      setMsg('✅ Ride accepted')
      await refreshAll(Number(driverId))
    } catch (e:any) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

    async function onReject() {
    if (!canReject || !ride) return
    try {
      setBusy(true); setMsg('')
      const res = await fetch('/api/driver/reject', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cfg, driver_id: Number(driverId), ride_id: ride.ride_id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Reject failed')
      setMsg('🚫 Ride rejected')
      await refreshAll(Number(driverId))
    } catch (e:any) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function fetchOnlineFromDb(currentDriverId: number) {
    if (!cfg) return
    try {
      const u = new URL('/api/driver/availability', window.location.origin)
      u.searchParams.set('driver_id', String(currentDriverId))
      u.searchParams.set('host', cfg.host)
      u.searchParams.set('port', String(cfg.port))
      u.searchParams.set('database', cfg.database)
      u.searchParams.set('user', cfg.user)
      u.searchParams.set('password', cfg.password)
      const res = await fetch(u.toString(), { method: 'GET', cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setIsOnline(Boolean(data.is_online))
        setDrivers(ds => ds.map(d => d.driver_id === currentDriverId ? { ...d, is_online: Boolean(data.is_online) } : d))
      }
    } catch {  }
  }

  async function onToggleOnline(next: boolean) {
    if (!cfg || !driverId || savingOnline) return
    setSavingOnline(true); setMsg('')
    try {
      const res = await fetch('/api/driver/availability', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        cache: 'no-store',
        body: JSON.stringify({ cfg, driver_id: Number(driverId), is_online: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update availability')

      // set from DB
      setIsOnline(Boolean(data.is_online))
      setDrivers(ds => ds.map(d =>
        d.driver_id === Number(driverId) ? { ...d, is_online: Boolean(data.is_online) } : d
      ))
      await refreshAll(Number(driverId))
    } catch (e:any) {
      setMsg(`❌ ${e.message}`)
      await fetchOnlineFromDb(Number(driverId))
    } finally {
      setSavingOnline(false)
    }
  }
  useEffect(() => {
    if (!cfg || !driverId) return
    fetchOnlineFromDb(Number(driverId))
    const id = setInterval(() => fetchOnlineFromDb(Number(driverId)), 15000)
    return () => clearInterval(id)
  }, [cfg, driverId])
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600">Driver dashboard</span>
        <select
          className="rounded-md border px-3 py-2"
          value={driverId}
          onChange={e => setDriverId(Number(e.target.value))}
        >
          {drivers.map(d => (
            <option key={d.driver_id} value={d.driver_id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {/* Ride request card */}
      <div className="rounded-2xl border p-6">
        <h3 className="text-lg font-semibold">🚗 Ride Request</h3>
        {!ride ? (
          <p className="mt-2 text-sm text-gray-600">No pending requests.</p>
        ) : (
          <div className="mt-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-gray-500">Rider</div>
                <div className="font-medium">{ride.rider_name}</div>
              </div>
              <div>
                <div className="text-gray-500">Category</div>
                <div className="font-medium">{ride.category_name}</div>
              </div>
              <div>
                <div className="text-gray-500">From</div>
                <div className="font-medium">{ride.origin_name}</div>
              </div>
              <div>
                <div className="text-gray-500">To</div>
                <div className="font-medium">{ride.dest_name}</div>
              </div>
              <div>
                <div className="text-gray-500">Distance</div>
                <div className="font-medium">{miles(ride.distance_miles)}</div>
              </div>
              <div>
                <div className="text-gray-500">Payout</div>
                <div className="font-medium">${money(ride.driver_payout_cents)}</div>
              </div>
            </div>

            {/* Payout & Fees Breakdown*/}
            <div className="mt-6 rounded-xl border p-4">
              <div className="font-medium mb-2">Payout Breakdown</div>

              {/* Context row */}
              <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                <div>
                  <div className="text-gray-500">Distance</div>
                  <div className="font-medium">{miles(ride.distance_miles)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Rate</div>
                  <div className="font-medium">
                    ${money(ride.rate_cents_per_mile_applied)} / mi
                  </div>
                </div>
              </div>

              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Base fare</span>
                  <span>${money(ride.fare_base_cents)}</span>
                </div>


                <hr className="my-2" />

                <div className="flex justify-between">
                  <span>Company commission ({ride.company_commission_pct_applied}%)</span>
                  <span>- ${money(ride.company_commission_cents)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Driver deduction ({ride.driver_deduction_pct_applied}%)</span>
                  <span>- ${money(ride.driver_deduction_cents)}</span>
                </div>

                <div className="flex justify-between text-green-700 font-semibold mt-2">
                  <span>Driver payout (net)</span>
                  <span>${money(ride.driver_payout_cents)}</span>
                </div>
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <button
                onClick={onAccept}
                disabled={!canAccept || busy}
                className="flex-1 rounded-xl bg-black text-white py-2 text-sm font-medium disabled:opacity-50"
              >
                {busy ? 'Processing…' : 'Accept Ride'}
              </button>
              <button
                onClick={onReject}
                disabled={!canReject || busy}
                className="flex-1 rounded-xl border border-red-500 text-red-600 py-2 text-sm font-medium disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </div>

      {/* At a Glance */}
      <div className="rounded-2xl border p-6">
        <h3 className="text-lg font-semibold">At a Glance</h3>
        <div className="mt-2 text-sm">
          <div className="mb-2">📍 You are at <b>{currentArea || '—'}</b></div>
          <div className="text-3xl font-semibold">${money(earnToday)}</div>
          <div className="text-xs text-gray-500">{ridesDone} completed rides</div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <label className="text-sm">Available for rides</label>
          <button
            onClick={() => onToggleOnline(!isOnline)}
            disabled={savingOnline || !cfg || !driverId}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition
              ${isOnline ? 'bg-black' : 'bg-gray-300'} ${savingOnline ? 'opacity-60' : ''}`}
            title={savingOnline ? 'Updating…' : (isOnline ? 'Go offline' : 'Go online')}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition
              ${isOnline ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* Ride History */}
      <div className="rounded-2xl border p-6">
        <h3 className="text-lg font-semibold">Ride History</h3>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No rides yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2 pr-3">Ride #</th>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">From</th>
                  <th className="py-2 pr-3">To</th>
                  <th className="py-2 pr-3">Cat</th>
                  <th className="py-2 pr-3">Total</th>
                  <th className="py-2 pr-3">Payout</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.ride_id} className="border-t">
                    <td className="py-2 pr-3 font-medium">{r.ride_id}</td>
                    <td className="py-2 pr-3">{dateTime(r.requested_at)}</td>
                    <td className="py-2 pr-3">{r.origin_name}</td>
                    <td className="py-2 pr-3">{r.dest_name}</td>
                    <td className="py-2 pr-3">{r.category_name}</td>
                    <td className="py-2 pr-3">${money(r.fare_total_cents)}</td>
                    <td className="py-2 pr-3">${money(r.driver_payout_cents)}</td>
                    <td className="py-2">
                      <span className="rounded-full px-2 py-0.5 text-xs border">
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {msg && <p className="text-sm">{msg}</p>}
    </div>
  )
}