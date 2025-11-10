'use client'

import { useEffect, useState } from 'react'
import SetupScreen from '@/components/setup-screen'
import RiderSide from '@/components/rider-side'
import DriverDashboard from '@/components/driver-side'
import CompanyDashboard from '@/components/company-dashboard'

type View = 'setup' | 'rider' | 'driver' | 'company'

export default function HomePage() {
  const [view, setView] = useState<View>('setup')

  // Auto-switch to Rider if a config is already present
  useEffect(() => {
    try {
      const raw = localStorage.getItem('rb.db.config')
      if (!raw) return
      const cfg = JSON.parse(raw) || {}
      const ready = cfg.host && cfg.port && cfg.database && cfg.user && cfg.password
      if (ready) setView('rider')
    } catch {}
  }, [])

  // Allow setup screen to emit a ready event
  useEffect(() => {
    const onReady = () => setView('rider')
    window.addEventListener('rb:ready', onReady)
    return () => window.removeEventListener('rb:ready', onReady)
  }, [])

  return (
    <main className="min-h-screen bg-gray-50 flex items-start justify-center p-6">
      <div className="w-full max-w-6xl">
        {/* --- Top Tabs --- */}
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setView('setup')}
            className={`px-3 py-1 rounded-full border text-sm ${
              view === 'setup' ? 'bg-white' : 'bg-gray-100 hover:bg-white'
            }`}
          >
            Setup
          </button>
          <button
            onClick={() => setView('rider')}
            className={`px-3 py-1 rounded-full border text-sm ${
              view === 'rider' ? 'bg-white' : 'bg-gray-100 hover:bg-white'
            }`}
          >
            Rider
          </button>
          <button
            onClick={() => setView('driver')}
            className={`px-3 py-1 rounded-full border text-sm ${
              view === 'driver' ? 'bg-white' : 'bg-gray-100 hover:bg-white'
            }`}
          >
            Driver
          </button>
          <button
            onClick={() => setView('company')}
            className={`px-3 py-1 rounded-full border text-sm ${
              view === 'driver' ? 'bg-white' : 'bg-gray-100 hover:bg-white'
            }`}
          >
            Company
          </button>
        </div>

        {/* --- Page Content --- */}
        {view === 'setup' && <SetupScreen />}
        {view === 'rider' && <RiderSide />}
        {view === 'driver' && <DriverDashboard />}
        {view === 'company' && <CompanyDashboard />}

      </div>
    </main>
  )
}