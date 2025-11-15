'use client'
import { useEffect, useMemo, useState } from 'react'

type DbCfg = { host:string; port:string; database:string; user:string; password:string }
const LS_KEY = 'rb.db.config'

type Overview = {
  total_rides: number
  company_earnings_cents: number
  driver_payouts_cents: number
  tax_collected_cents: number
}
type HotRow = { location_id:number; name:string; is_hot_area:boolean; commission_discount_pct:number; eff_commission_pct:number }
type RouteRow = { origin:string; dest:string; rides:number; revenue_cents:number }
type DriverRow = { driver_id:number; driver_name:string; payout_cents:number }
type RiderRow = { rider_id:number; rider_name:string; spend_cents:number }
type DeductionRow = { deduction_type_id?: number; name: string; default_pct: number }

export default function CompanyDashboard() {
  const [tab, setTab] = useState<'overview'|'reports'|'hot'|'settings'>('overview')
  const [cfg, setCfg] = useState<DbCfg|null>(null)
  const [range, setRange] = useState<'7d'|'30d'|'all'>('7d')

  const [ov, setOv] = useState<Overview| null>(null)
  const [hot, setHot] = useState<HotRow[]>([])
  const [routes, setRoutes] = useState<RouteRow[]>([])
  const [drivers, setDrivers] = useState<DriverRow[]>([])
  const [riders, setRiders] = useState<RiderRow[]>([])
  const [deductions, setDeductions] = useState<DeductionRow[]>([])
  const [msg, setMsg] = useState('')

  const nf2 = useMemo(() => new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}),[])
  const money = (c:number|undefined|null)=> `$${nf2.format(((c??0) as number)/100)}`

  // load cfg
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) { setMsg('⚠️ Run Setup first.'); return }
    try { setCfg(JSON.parse(raw)) } catch {}
  }, [])

  // overview
  useEffect(() => {
    if (!cfg) return
    fetch('/api/company/overview', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ cfg, range })
    })
      .then(r=>r.json())
      .then(d => { if(!d.error) setOv(d) })
      .catch(()=>{})
  }, [cfg, range])

  // reports
  useEffect(() => {
    if (!cfg || tab!=='reports') return
    fetch('/api/company/reports', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ cfg, range })
    })
      .then(r=>r.json())
      .then(d => {
        if(!d.error){
          setRoutes(d.top_routes||[])
          setDrivers(d.top_drivers||[])
          setRiders(d.rider_spend||[])
        }
      })
      .catch(()=>{})
  }, [cfg, tab, range])

  // hot areas
  useEffect(() => {
    if (!cfg || tab !== 'hot') return

    const load = () => {
      fetch('/api/company/hot-areas', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body: JSON.stringify({ cfg })
      })
        .then(r=>r.json())
        .then(d => { if(!d.error) setHot(d.rows||[]) })
        .catch(()=>{})
    }

    load()
    const onHot = () => load()
    const onSettings = () => load()

    window.addEventListener('company:hot-updated', onHot)
    window.addEventListener('company:settings-updated', onSettings)
    return () => {
      window.removeEventListener('company:hot-updated', onHot)
      window.removeEventListener('company:settings-updated', onSettings)
    }
  }, [cfg, tab])

  // settings (deduction types only)
  useEffect(() => {
    if (!cfg || tab !== 'settings') return
    fetch('/api/company/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cfg, op: 'get' })
    })
      .then(r => r.json())
      .then(d => { if (!d.error) setDeductions(d.deduction_types || []) })
      .catch(() => {})
  }, [cfg, tab])

  // actions
  function setHotDiscount(id:number, val:number){
    setHot(rows => rows.map(r => r.location_id===id ? { ...r, commission_discount_pct: val } : r))
  }

  async function saveHot(r: HotRow) {
    if (!cfg) return
    await fetch('/api/company/hot-areas/update', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({
        cfg,
        location_id: r.location_id,
        is_hot_area: r.is_hot_area,
        commission_discount_pct: r.commission_discount_pct
      })
    }).catch(()=>{})

    // refresh
    const res = await fetch('/api/company/hot-areas', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ cfg })
    })
    const d = await res.json()
    if (!d.error) setHot(d.rows || [])
    window.dispatchEvent(new CustomEvent('company:hot-updated'))
  }

  async function saveSettings() {
    if (!cfg) return
    const res = await fetch('/api/company/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cfg,
        op: 'set',
        deduction_types: deductions.map(x => ({
          name: x.name,
          default_pct: Number.isFinite(Number(x.default_pct)) ? Number(x.default_pct) : 0
        }))
      })
    })
    const d = await res.json()
    const ok = !d.error
    setMsg(ok ? '✅ Deductions saved' : `❌ ${d.error || 'Save failed'}`)

    // Let Hot Areas recompute effective commission (base may have changed)
    if (ok) window.dispatchEvent(new CustomEvent('company:settings-updated'))
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2">
        {([
          ['overview','Overview'],
          ['reports','Reports'],
          ['hot','Hot Areas'],
        ] as const).map(([k,label]) => (
          <button key={k} onClick={()=>setTab(k)}
            className={`px-3 py-1 rounded-full border text-sm ${tab===k ? 'bg-white' : 'bg-gray-100 hover:bg-white'}`}>
            {label}
          </button>
        ))}
        <button onClick={()=>setTab('settings')}
          className={`px-3 py-1 rounded-full border text-sm ${tab==='settings' ? 'bg-white' : 'bg-gray-100 hover:bg-white'}`}>
          Settings
        </button>
      </div>

      {tab==='overview' && (
        <div>
          <h2 className="text-2xl font-semibold mb-4">Company Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card title="Total Rides" big={ov?.total_rides ?? 0} />
            <Card title="Company Earnings" money big={ov?.company_earnings_cents ?? 0} />
            <Card title="Total Driver Payouts" money big={ov?.driver_payouts_cents ?? 0} />
            <Card title="Tax Collected" money big={ov?.tax_collected_cents ?? 0} />
          </div>
        </div>
      )}

      {tab==='reports' && (
        <div className="space-y-6">
          <Block title="Top Routes by Revenue">
            {routes.length===0 ? <Empty/> : (
              <Table cols={['Route','Rides','Revenue']}>
                {routes.map((r,i)=>(
                  <tr key={i} className="border-t">
                    <td className="py-2 pr-3">{r.origin} → {r.dest}</td>
                    <td className="py-2 pr-3">{r.rides}</td>
                    <td className="py-2">{money(r.revenue_cents)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Block>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Block title="Top Drivers by Payout">
              {drivers.length===0 ? <Empty/> : (
                <Table cols={['Driver','Payout']}>
                  {drivers.map((d,i)=>(
                    <tr key={i} className="border-t">
                      <td className="py-2 pr-3">{d.driver_name}</td>
                      <td className="py-2">{money(d.payout_cents)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Block>
            <Block title="Rider Spend Leaderboard">
              {riders.length===0 ? <Empty/> : (
                <Table cols={['Rider','Spend']}>
                  {riders.map((r,i)=>(
                    <tr key={i} className="border-t">
                      <td className="py-2 pr-3">{r.rider_name}</td>
                      <td className="py-2">{money(r.spend_cents)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Block>
          </div>
        </div>
      )}

      {tab==='hot' && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold">Hot Areas Management</h3>
          <Table cols={['Location','Status','Discount %','Effective Commission','']}>
            {hot.map(row=>(
              <tr key={row.location_id} className="border-t">
                <td className="py-2 pr-3">{row.name}</td>
                <td className="py-2 pr-3">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.is_hot_area}
                      onChange={e => setHot(h=>h.map(x=>x.location_id===row.location_id ? { ...x, is_hot_area: e.target.checked } : x))}
                    />
                    <span className="rounded-full bg-orange-100 px-2 py-0.5">🔥 Hot</span>
                  </label>
                </td>
                <td className="py-2 pr-3">
                  <input
                    className="w-20 rounded-md border px-2 py-1 text-sm"
                    value={row.commission_discount_pct}
                    onChange={e=> setHotDiscount(row.location_id, Number(e.target.value)||0)}
                  />
                </td>
                <td className="py-2 pr-3">{row.eff_commission_pct}%</td>
                <td className="py-2">
                  <button onClick={()=>saveHot(row)} className="rounded-md border px-3 py-1 text-sm">Save</button>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-6">
          <h3 className="text-xl font-semibold">Global Settings</h3>
          <div>
            <h4 className="text-lg font-semibold mb-2">Deduction Types</h4>
            {deductions.length === 0 ? (
              <Empty />
            ) : (
              <Table cols={['Name', 'Default %']}>
                {deductions.map((d, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-2 pr-3">{d.name}</td>
                    <td className="py-2">
                      <input
                        className="w-24 rounded-md border px-2 py-1 text-sm"
                        value={d.default_pct}
                        onChange={e => {
                          const v = Number(e.target.value)
                          setDeductions(rows =>
                            rows.map((row, idx) =>
                              idx === i ? { ...row, default_pct: isNaN(v) ? 0 : v } : row
                            )
                          )
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </div>

          <div>
            <button
              onClick={saveSettings}
              className="rounded-xl bg-black text-white px-4 py-2 text-sm"
            >
              Save
            </button>
            {msg && <p className="mt-2 text-sm">{msg}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function Card({ title, big, money=false }:{title:string; big:number; money?:boolean}) {
  const nf = new Intl.NumberFormat(undefined,{minimumFractionDigits: money?2:0, maximumFractionDigits: money?2:0})
  const val = money ? `$${nf.format(big/100)}` : nf.format(big)
  return (
    <div className="rounded-2xl border p-6">
      <div className="text-gray-600">{title}</div>
      <div className="mt-2 text-3xl font-semibold">{val}</div>
    </div>
  )
}

function Block({ title, children }:{title:string; children:any}) {
  return (
    <div className="rounded-2xl border p-6">
      <div className="mb-3 text-lg font-semibold">{title}</div>
      {children}
    </div>
  )
}

function Table({ cols, children }:{cols:string[]; children:any}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            {cols.map((c,i)=><th key={i} className="py-2 pr-3">{c}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Empty(){ return <p className="text-sm text-gray-500">No data yet</p> }