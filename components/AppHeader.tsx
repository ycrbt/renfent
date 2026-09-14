'use client'

import { useRouter } from 'next/navigation'
import { useSession } from '@/context/SessionContext'

export default function AppHeader() {
  const router = useRouter()
  const { clearSession } = useSession()

  function restart() {
    clearSession()
    window.dispatchEvent(new Event('renfent:restart'))
    router.push('/')
  }

  return (
    <header className="bg-[#e3000f] shadow-md">
      <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
        <svg className="w-7 h-7 text-white flex-none" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 4h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v8h16V6H4zm2 10h12v2H6v-2z"/>
        </svg>
        <div className="min-w-0 flex-1">
          <h1 className="text-white text-xl font-bold leading-tight">Renfent</h1>
          <p className="text-red-200 text-xs">Reserva automática de asientos · Abono/Pase</p>
        </div>
        <button
          type="button"
          onClick={restart}
          className="flex-none inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20 transition"
          aria-label="Volver al inicio y reiniciar el proceso"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v5a2 2 0 0 1-2 2h-3v-5H9v5H6a2 2 0 0 1-2-2v-5H3a1 1 0 0 1-.707-1.707l7-7Z"/>
          </svg>
          <span className="hidden sm:inline">Inicio</span>
        </button>
      </div>
    </header>
  )
}
