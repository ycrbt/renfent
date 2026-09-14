import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { SessionProvider } from '@/context/SessionContext'
import AppHeader from '@/components/AppHeader'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Renfent — Reserva automática',
  description: 'Reserva automática de asientos con Abono/Pase Renfe',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={`${geist.className} bg-zinc-100 min-h-screen`}>
        <SessionProvider>
          <AppHeader />
          <main className="max-w-2xl mx-auto px-4 py-8">
            {children}
          </main>
        </SessionProvider>
      </body>
    </html>
  )
}
