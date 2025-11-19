'use client'
import { useEffect, useMemo, useState } from 'react'

type DbCfg = { host: string; port: string; database: string; user: string; password: string }
const LS_KEY = 'rb.db.config'

type RideStatus = string;
type Rider = { rider_id: number; name: string; email: string }
type Loc   = { location_id: number; name: string; is_hot_area: boolean }
type Cat   = { category_id: number; name: string; rate_cents_per_mile: number }

type PaymentMethod = 'card' | 'wallet'

type Quote = {
  distance_miles: number
  hot_area: boolean
  breakdown: {
    fare_base_cents: number
    rider_fee_cents: number
    tax_cents: number
    fare_total_cents: number
    company_commission_cents: number
    driver_deduction_cents: number
    driver_payout_cents: number
    company_commission_pct_applied: number
    rider_fee_pct_applied: number
    driver_deduction_pct_applied: number
    tax_pct_applied: number
    rate_cents_per_mile_applied: number
  }
}

type NearestDriver = {
  driver_id: number
  name: string
  email: string
  is_online: boolean
  distance_miles: number
  eta_min: number
  driver_area: string | null
}

type RideRow = {
  ride_id: number
  requested_at: string
  origin_name: string
  dest_name: string
  category_name: string
  driver_name: string
  distance_miles: number | null
  fare_total_cents: number
  status: RideStatus
  payment_method?: string 
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-gray-700">{label}</span>
      {children}
    </label>
  )
}

export default function RiderSide() {
  const [cfg, setCfg] = useState<DbCfg | null>(null)
  const [riders, setRiders] = useState<Rider[]>([])
  const [locs, setLocs] = useState<Loc[]>([])
  const [cats, setCats] = useState<Cat[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  

  const [riderId, setRiderId] = useState<number | ''>('')
  const [originId, setOriginId] = useState<number | ''>('')
  const [destId, setDestId] = useState<number | ''>('')
  const [catId, setCatId] = useState<number | ''>('')

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card')


  const [quote, setQuote] = useState<Quote | null>(null)
  const [nearest, setNearest] = useState<NearestDriver | null>(null)

  const [history, setHistory] = useState<RideRow[]>([])
  const [histBusy, setHistBusy] = useState(false)

  const [walletCents, setWalletCents] = useState<number>(0)

  const nf2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const money = (cents?: number) => ((cents ?? 0) / 100)
  const dollars = (cents?: number) => nf2.format(money(cents))
  const milesFmt = (v: number | null | undefined) => (v == null ? '—' : nf2.format(v))
  const dateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '—')

  async function onGetQuote() {
    if (!cfg || !riderId || !originId || !destId || !catId) return
    setBusy(true); setMsg(''); setQuote(null)
    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cfg,
          rider_id: Number(riderId),
          origin_location_id: Number(originId),
          dest_location_id: Number(destId),
          category_id: Number(catId),
          method: paymentMethod,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Quote failed')
      setQuote(data)
    } catch (e:any) {
      setMsg(`❌ ${e.message || 'Quote failed'}`)
    } finally {
      setBusy(false)
    }
  }
  
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) { setMsg('⚠️ Run Setup and save DB config first.'); return }
    try {
      const parsed = JSON.parse(raw) as DbCfg
      setCfg(parsed)
      fetch('/api/meta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cfg: parsed }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.error) throw new Error(data.error)
          setRiders(data.riders || [])
          setLocs(data.locations || [])
          setCats(data.categories || [])
          if ((data.riders || []).length) setRiderId(data.riders[0].rider_id)
        })
        .catch(e => setMsg(`❌ ${e.message}`))
    } catch {}
  }, [])

  const canQuote = useMemo(
    () => !!(cfg && riderId && originId && destId && catId && originId !== destId),
    [cfg, riderId, originId, destId, catId]
  )

  async function onBookRide() {
    if (!cfg || !riderId || !originId || !destId || !catId || !nearest) {
      setMsg('❌ Choose rider, origin, destination, category (and make sure a driver is shown).')
      return
    }
    try {
      setBusy(true); setMsg('')
      const res = await fetch('/api/rides/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cfg,
          rider_id: Number(riderId),
          driver_id: nearest.driver_id,
          origin_location_id: Number(originId),
          dest_location_id: Number(destId),
          category_id: Number(catId),
          method: paymentMethod,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Booking failed')
      setMsg(`✅ Ride #${data.ride_id} created. Total $${dollars(data.total_cents)}`)
      setQuote(null)
      await loadHistory()
    } catch (e:any) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
  if (!cfg || !originId) { setNearest(null); return }

  let alive = true
  const fetchNearest = async () => {
    try {
      const res = await fetch('/api/nearest-driver', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        cache: 'no-store',
        body: JSON.stringify({ cfg, origin_location_id: Number(originId) }),
      })
      const data = await res.json()
      if (!alive) return
      if (res.ok) setNearest(data); else setNearest(null)
    } catch { if (alive) setNearest(null) }
  }

  // initial + poll every 5s (so toggling availability shows up)
  fetchNearest()
  const t = setInterval(fetchNearest, 5000)

  return () => { alive = false; clearInterval(t) }
}, [cfg, originId])

  async function loadHistory() {
    if (!cfg || !riderId) return
    setHistBusy(true)
    try {
      const res = await fetch('/api/rider/history', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cfg, rider_id: Number(riderId), limit: 50 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load history')
      setHistory(data.rides || [])
      setWalletCents(Number(data.wallet_cents ?? 0))
    } catch (e:any) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setHistBusy(false)
    }
  }

  useEffect(() => { loadHistory().catch(()=>{}) }, [riderId, cfg])

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT */}
        <div className="rounded-2xl border p-6">
          <h2 className="text-lg font-semibold">Book a Ride</h2>
          <p className="text-sm text-gray-600">Enter trip details to get a quote</p>

          <div className="mt-4 space-y-4">
            <Labeled label="Rider account">
                <>
                  <select
                    className="w-full rounded-md border px-3 py-2"
                    value={riderId}
                    onChange={e => setRiderId(Number(e.target.value))}
                  >
                    {riders.map(r => (
                      <option key={r.rider_id} value={r.rider_id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Wallet balance: <span className="font-semibold">${dollars(walletCents)}</span>
                  </p>
                </>
              </Labeled>

            <Labeled label="Origin">
              <select className="w-full rounded-md border px-3 py-2"
                value={originId} onChange={e => setOriginId(Number(e.target.value))}>
                <option value="">Select origin</option>
                {locs.map(l => <option key={l.location_id} value={l.location_id}>
                  {l.name}{l.is_hot_area ? ' 🔥' : ''}
                </option>)}
              </select>
            </Labeled>

            <Labeled label="Destination">
              <select className="w-full rounded-md border px-3 py-2"
                value={destId} onChange={e => setDestId(Number(e.target.value))}>
                <option value="">Select destination</option>
                {locs.map(l => <option key={l.location_id} value={l.location_id}>{l.name}</option>)}
              </select>
            </Labeled>

            <Labeled label="Category">
              <select className="w-full rounded-md border px-3 py-2"
                value={catId} onChange={e => setCatId(Number(e.target.value))}>
                <option value="">Select category</option>
                {cats.map(c => <option key={c.category_id} value={c.category_id}>
                  {c.name} (${(c.rate_cents_per_mile/100).toFixed(2)}/mi)
                </option>)}
              </select>
            </Labeled>

            <Labeled label="Payment method">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  className={
                    `flex-1 rounded-md border px-3 py-2 text-sm ` +
                    (paymentMethod === 'card' ? 'bg-black text-white' : 'bg-white text-gray-700')
                  }
                >
                  Card
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('wallet')}
                  className={
                    `flex-1 rounded-md border px-3 py-2 text-sm ` +
                    (paymentMethod === 'wallet' ? 'bg-black text-white' : 'bg:white text-gray-700')
                  }
                >
                  Wallet
                </button>
              </div>
            </Labeled>

            {quote && (
              <div className="mt-1">
                <div className="text-sm text-gray-500">Distance</div>
                <div className="text-2xl font-semibold">{quote.distance_miles.toFixed(2)} miles</div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={onGetQuote}
                disabled={!canQuote || busy}
                className="inline-flex flex-1 items-center justify-center rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {busy ? 'Working…' : 'Get Quote'}
              </button>
              <button
                onClick={onBookRide}
                disabled={!quote || !nearest || busy}
                className="inline-flex flex-1 items-center justify-center rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? 'Booking…' : 'Book Ride'}
              </button>
            </div>

            {msg && <p className="text-sm text-center text-red-600">{msg}</p>}
          </div>
        </div>

        {/* RIGHT */}
        <div className="rounded-2xl border p-6">
          {/* Nearest driver card */}
          <h3 className="text-lg font-semibold mb-3">Your Driver</h3>
          {nearest ? (
            <div className="mb-5 rounded-xl border px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-black text-white flex items-center justify-center text-sm">
                  {nearest.name.slice(0,1).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{nearest.name}</div>
                  <div className="text-xs text-gray-500">
                    {nearest.driver_area ? `From ${nearest.driver_area}` : 'Nearby'}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-600">
                    <span>📍 {nearest.distance_miles.toFixed(1)} mi away</span>
                    <span className="mx-2">•</span>
                    <span>🕒 ETA {nearest.eta_min} min</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="mb-5 text-sm text-gray-500">Pick an origin to see the nearest driver.</p>
          )}

          <h3 className="text-lg font-semibold">
            Fare Breakdown {quote?.hot_area ? <span className="ml-2 text-xs rounded-full bg-orange-100 px-2 py-1">🔥 Hot Area</span> : null}
          </h3>

          {!quote ? (
            <p className="mt-2 text-sm text-gray-600">Pick origin, destination, and category, then click <b>Get Quote</b>.</p>
          ) : (
            <div className="mt-4 text-sm">
              <div className="flex justify-between py-1">
                <span>Base fare</span>
                <span>${dollars(quote.breakdown.fare_base_cents)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Rider fee ({quote.breakdown.rider_fee_pct_applied}%)</span>
                <span>${dollars(quote.breakdown.rider_fee_cents)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Tax ({quote.breakdown.tax_pct_applied}%)</span>
                <span>${dollars(quote.breakdown.tax_cents)}</span>
              </div>

              <hr className="my-2" />

              <div className="flex justify-between font-semibold py-1">
                <span>Total</span>
                <span>${dollars(quote.breakdown.fare_total_cents)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border p-6">
        <div className="mb-3 flex items-center">
          <h3 className="text-lg font-semibold">Ride History</h3>
          <button
            onClick={loadHistory}
            disabled={histBusy || !cfg || !riderId}
            className="ml-auto rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {histBusy ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {history.length === 0 ? (
          <p className="text-sm text-gray-600">No rides yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2 pr-3">Ride #</th>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">From</th>
                  <th className="py-2 pr-3">To</th>
                  <th className="py-2 pr-3">Cat</th>
                  <th className="py-2 pr-3">Driver</th>
                  <th className="py-2 pr-3">Miles</th>
                  <th className="py-2 pr-3">Total</th>
                  <th className="py-2 pr-3">Pay</th>
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
                    <td className="py-2 pr-3">{r.driver_name}</td>
                    <td className="py-2 pr-3">{milesFmt(r.distance_miles)}</td>
                    <td className="py-2 pr-3">${dollars(r.fare_total_cents)}</td>
                    <td className="py-2 pr-3">{r.payment_method ?? '—'}</td>
                    <td className="py-2">
                      <span className="rounded-full px-2 py-0.5 text-xs border">{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}