import '../styles/globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Link from 'next/link'
import type { ReactNode } from 'react'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'RiderBase',
  description: 'Local ride-sharing simulation dashboard',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear()

  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-50 text-gray-900 min-h-screen`}>

        <main className="p-6">{children}</main>

        <footer className="w-full border-t bg-white py-3 text-center text-xs text-gray-500 mt-8">
          RiderBase © {year}
        </footer>
      </body>
    </html>
  )
}