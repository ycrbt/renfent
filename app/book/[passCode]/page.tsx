'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, getPassStatus } from '@/context/SessionContext'
import DatePicker from '@/components/DatePicker'

export default function BookPage({ params }: { params: Promise<{ passCode: string }> }) {
  const { passCode } = use(params)
  const { session } = useSession()
  const router = useRouter()

  const decodedCode = decodeURIComponent(passCode)
  const pass = session?.passes.find(p => p.code === decodedCode)
  const passStatus = pass ? getPassStatus(pass) : 'unknown'

  // If the user landed here without a session (e.g. hard refresh), send them back
  if (!session) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-8 text-center space-y-3">
        <p className="text-zinc-600 text-sm">Sesión no encontrada. Vuelve al inicio y verifica la cookie.</p>
        <button
          onClick={() => router.push('/')}
          className="text-[#e3000f] text-sm font-medium hover:underline"
        >
          ← Volver al inicio
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Back + pass header */}
      <div>
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 transition mb-4"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/>
          </svg>
          Volver
        </button>

        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-zinc-500 mb-0.5">Pase seleccionado</p>
            <p className="font-semibold text-zinc-800">{pass?.title || pass?.type || decodedCode}</p>
            <p className="text-xs text-zinc-400 font-mono">{decodedCode}</p>
          </div>
          {pass && (
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium
              ${passStatus === 'active' || passStatus === 'upcoming' ? 'bg-emerald-100 text-emerald-700' :
                'bg-zinc-100 text-zinc-500'}`}>
              {passStatus === 'active' || passStatus === 'upcoming' ? 'Vigente' :
                passStatus === 'expired' ? 'Caducado' : 'Estado desconocido'}
            </span>
          )}
        </div>
      </div>

      {/* Date picker */}
      <DatePicker pass={pass ?? null} passCode={decodedCode} />
    </div>
  )
}
