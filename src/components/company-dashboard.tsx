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
type SettingsRow = {
  settings_id:number; tax_pct:number; company_commission_pct:number; rider_fee_pct:number; driver_deduction_pct:number; team_number:number
}
type RouteRow = { origin:string; dest:string; rides:number; revenue_cents:number }
type DriverRow = { driver_id:number; driver_name:string; payout_cents:number }
type RiderRow = { rider_id:number; rider_name:string; spend_cents:number }

export default function CompanyDashboard() {
  const [tab, setTab] = useState<'overview'|'reports'|'hot'|'settings'>('overview')
  const [cfg, setCfg] = useState<DbCfg|null>(null)
  const [range, setRange] = useState<'7d'|'30d'|'all'>('7d')

  const [ov, setOv] = useState<Overview| null>(null)
  const [hot, setHot] = useState<HotRow[]>([])
  const [settings, setSettings] = useState<SettingsRow | null>(null)
  const [routes, setRoutes] = useState<RouteRow[]>([])
  const [drivers, setDrivers] = useState<DriverRow[]>([])
  const [riders, setRiders] = useState<RiderRow[]>([])
  const [msg, setMsg] = useState('')

  const nf2 = useMemo(() => new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}),[])
  const money = (c:number|undefined|null)=> `$${nf2.format(((c??0) as number)/100)}`

  // load cfg
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) { setMsg('⚠️ Run Setup first.'); return }
    try { setCfg(JSON.parse(raw)) } catch {}
  }, [])

  // fetchers
  useEffect(() => {
    if (!cfg) return
    // Overview
    fetch('/api/company/overview', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ cfg, range }) })
      .then(r=>r.json()).then(d => { if(!d.error) setOv(d) }).catch(()=>{})
  }, [cfg, range])

  useEffect(() => {
    if (!cfg || tab!=='reports') return
    fetch('/api/company/reports', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ cfg, range }) })
      .then(r=>r.json()).then(d => { if(!d.error){ setRoutes(d.top_routes||[]); setDrivers(d.top_drivers||[]); setRiders(d.rider_spend||[]) }})
      .catch(()=>{})
  }, [cfg, tab, range])

  useEffect(() => {
    if (!cfg || tab!=='hot') return
    fetch('/api/company/hot-areas', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ cfg }) })
      .then(r=>r.json()).then(d => { if(!d.error) setHot(d.rows||[]) }).catch(()=>{})
  }, [cfg, tab])

  useEffect(() => {
    if (!cfg || tab!=='settings') return
    fetch('/api/company/settings', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ cfg, op:'get' }) })
      .then(r=>r.json()).then(d => { if(!d.error) setSettings(d.settings) }).catch(()=>{})
  }, [cfg, tab])

  // actions
  function setHotDiscount(id:number, val:number){
    setHot(rows => rows.map(r => r.location_id===id ? { ...r, commission_discount_pct: val } : r))
  }
  async function saveHot(r:HotRow){
    if (!cfg) return
    await fetch('/api/company/hot-areas/update', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ cfg, location_id:r.location_id, is_hot_area:r.is_hot_area, commission_discount_pct:r.commission_discount_pct }) })
    // refetch to recompute effective commission
    const res = await fetch('/api/company/hot-areas', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ cfg }) })
    const d = await res.json(); if(!d.error) setHot(d.rows||[])
  }

  async function saveSettings(){
    if (!cfg || !settings) return
    const res = await fetch('/api/company/settings', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ cfg, op:'set', settings }) })
    const d = await res.json()
    setMsg(d.error ? `❌ ${d.error}` : '✅ Settings saved')
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2">
        {[
          ['overview','Overview'],
          ['reports','Reports'],
          ['hot','Hot Areas'],
          ['settings','Settings'],
        ].map(([k,label]) => (
          <button key={k} onClick={()=>setTab(k as any)}
            className={`px-3 py-1 rounded-full border text-sm ${tab===k ? 'bg-white' : 'bg-gray-100 hover:bg-white'}`}>
            {label}
          </button>
        ))}
        <div className="ml-auto">
          <select value={range} onChange={e=>setRange(e.target.value as any)} className="rounded-md border px-3 py-1 text-sm">
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
        </div>
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
                    <input type="checkbox" checked={row.is_hot_area} onChange={e => setHot(h=>h.map(x=>x.location_id===row.location_id ? { ...x, is_hot_area: e.target.checked } : x))}/>
                    <span className="rounded-full bg-orange-100 px-2 py-0.5">🔥 Hot</span>
                  </label>
                </td>
                <td className="py-2 pr-3">
                  <input className="w-20 rounded-md border px-2 py-1 text-sm"
                         value={row.commission_discount_pct}
                         onChange={e=> setHotDiscount(row.location_id, Number(e.target.value)||0)} />
                </td>
                <td className="py-2 pr-3">{(row.eff_commission_pct)}%</td>
                <td className="py-2">
                  <button onClick={()=>saveHot(row)} className="rounded-md border px-3 py-1 text-sm">Save</button>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {tab==='settings' && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold">Global Settings</h3>
          {!settings ? <Empty/> : (
            <div className="grid gap-4 max-w-lg">
              <Field label="Tax Percentage">
                <input className="w-full rounded-md border px-3 py-2" value={settings.tax_pct}
                       onChange={e=>setSettings({ ...settings!, tax_pct: Number(e.target.value)||0 })}/>
              </Field>
              <Field label="Company Commission Percentage">
                <input className="w-full rounded-md border px-3 py-2" value={settings.company_commission_pct}
                       onChange={e=>setSettings({ ...settings!, company_commission_pct: Number(e.target.value)||0 })}/>
              </Field>
              <Field label="Rider Fee Percentage">
                <input className="w-full rounded-md border px-3 py-2" value={settings.rider_fee_pct}
                       onChange={e=>setSettings({ ...settings!, rider_fee_pct: Number(e.target.value)||0 })}/>
              </Field>
              <Field label="Driver Deduction Percentage">
                <input className="w-full rounded-md border px-3 py-2" value={settings.driver_deduction_pct}
                       onChange={e=>setSettings({ ...settings!, driver_deduction_pct: Number(e.target.value)||0 })}/>
              </Field>
              <Field label="Team Number">
                <input className="w-full rounded-md border px-3 py-2" value={settings.team_number}
                       onChange={e=>setSettings({ ...settings!, team_number: Number(e.target.value)||0 })}/>
              </Field>
              <div><button onClick={saveSettings} className="rounded-xl bg-black text-white px-4 py-2 text-sm">Save</button></div>
              {msg && <p className="text-sm">{msg}</p>}
            </div>
          )}
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

function Field({label, children}:{label:string; children:any}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-gray-700">{label}</span>
      {children}
    </label>
  )
}
function Empty(){ return <p className="text-sm text-gray-500">No data yet</p> }