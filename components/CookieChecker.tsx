'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, getPassStatus, type PassInfo } from '@/context/SessionContext'

interface CheckResult {
  ok: boolean
  message: string
  cookie_count?: number
  passes?: PassInfo[]
}

export default function CookieChecker() {
  const router = useRouter()
  const { session, setSession, clearSession } = useSession()

  const [cookie, setCookie] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CheckResult | null>(null)
  const [validationError, setValidationError] = useState('')
  const [checkedAt, setCheckedAt] = useState('')

  // Rehydrate UI from stored session on first render
  useEffect(() => {
    if (session) {
      setCookie(session.cookie)
      setResult({
        ok: true,
        message: 'Sesión restaurada desde esta pestaña.',
        cookie_count: session.passes.length,
        passes: session.passes,
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function restart() {
      setCookie('')
      setResult(null)
      setValidationError('')
      setCheckedAt('')
    }
    window.addEventListener('renfent:restart', restart)
    return () => window.removeEventListener('renfent:restart', restart)
  }, [])

  function reset() {
    setResult(null)
    setValidationError('')
  }

  async function handleCheck() {
    const raw = cookie.trim()
    if (!raw) return
    if (raw.length < 20 || !raw.includes('=')) {
      setValidationError('Esto no parece una cabecera Cookie válida.')
      return
    }
    setValidationError('')
    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/check-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: raw }),
      })
      const data: CheckResult = await res.json()
      setResult(data)
      setCheckedAt(new Date().toLocaleTimeString('es-ES'))
      if (data.ok) {
        setSession({ cookie: raw, passes: data.passes ?? [] })
      }
    } catch {
      setResult({ ok: false, message: 'Error de red al contactar con el servidor.' })
    } finally {
      setLoading(false)
    }
  }

  function handleSelectPass(pass: PassInfo) {
    router.push(`/book/${encodeURIComponent(pass.code)}`)
  }

  return (
    <div className="space-y-5">
      {/* Instructions */}
      <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6">
        <h2 className="text-lg font-semibold text-zinc-800 mb-1">Sesión de Renfe</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Para reservar asientos necesitas una sesión activa en{' '}
          <a
            href="https://venta.renfe.com"
            target="_blank"
            rel="noreferrer"
            className="text-[#e3000f] underline hover:no-underline"
          >
            venta.renfe.com
          </a>
          .
        </p>

        <ol className="text-sm text-zinc-600 space-y-1.5 list-decimal list-inside mb-5">
          <li>Inicia sesión en <span className="font-medium">venta.renfe.com</span>.</li>
          <li>Abre DevTools <span className="text-zinc-400">(F12)</span> → pestaña <span className="font-medium">Network</span>.</li>
          <li>Haz clic en cualquier petición a <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">venta.renfe.com</code>.</li>
          <li>Copia el valor completo de la cabecera <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">Cookie:</code>.</li>
          <li>Pégalo aquí abajo y pulsa <span className="font-medium">Verificar sesión</span>.</li>
        </ol>

        <label htmlFor="cookie-input" className="block text-sm font-medium text-zinc-700 mb-1">
          Cabecera Cookie
        </label>
        <textarea
          id="cookie-input"
          rows={4}
          value={cookie}
          onChange={e => { setCookie(e.target.value); reset() }}
          placeholder="Pega aquí el valor de la cabecera Cookie:"
          spellCheck={false}
          className={`w-full rounded-xl border bg-zinc-50 px-4 py-3 text-xs font-mono text-zinc-800
            placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#e3000f]
            focus:border-transparent resize-none transition
            ${validationError ? 'border-red-400 bg-red-50' : 'border-zinc-300'}`}
        />
        {validationError && (
          <p className="mt-1 text-xs text-red-500">{validationError}</p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleCheck}
            disabled={loading || !cookie.trim()}
            className="inline-flex items-center gap-2 bg-[#e3000f] text-white text-sm font-semibold
              px-5 py-2.5 rounded-xl shadow hover:bg-red-700 active:bg-red-800
              disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {loading && (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {loading ? 'Verificando…' : 'Verificar sesión'}
          </button>
          {cookie && (
            <button
              onClick={() => { setCookie(''); reset() }}
              className="text-sm text-zinc-400 hover:text-zinc-600 transition"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className={`rounded-2xl shadow-sm border p-6 space-y-4
          ${result.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>

          {/* Status row */}
          <div className="flex items-center gap-3">
            <span className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center
              ${result.ok ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500'}`}>
              {result.ok ? (
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                </svg>
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
              )}
            </span>
            <div>
              <p className="font-semibold text-zinc-800">{result.ok ? 'Sesión activa' : 'Sesión inválida'}</p>
              <p className={`text-sm ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>{result.message}</p>
            </div>
          </div>

          {/* Pass list */}
          {result.ok && result.passes && result.passes.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Selecciona un abono / pase para continuar
              </p>
              {result.passes.map(pass => (
                (() => {
                  const status = getPassStatus(pass)
                  return (
                <button
                  key={pass.code}
                  onClick={() => handleSelectPass(pass)}
                  className="w-full text-left bg-white rounded-xl border border-emerald-100 px-4 py-3
                    flex items-center justify-between gap-4 shadow-sm
                    hover:border-[#e3000f] hover:shadow-md transition group"
                >
                  <div>
                    <p className="font-semibold text-zinc-800 text-sm group-hover:text-[#e3000f] transition">
                      {pass.title || pass.type}
                    </p>
                    <p className="text-xs text-zinc-500 font-mono">{pass.code}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-xs text-zinc-500">{pass.start} – {pass.end}</p>
                      <span className={`inline-block mt-0.5 text-xs px-2 py-0.5 rounded-full font-medium
                        ${status === 'active' || status === 'upcoming' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-zinc-100 text-zinc-500'}`}>
                        {status === 'active' || status === 'upcoming' ? 'Vigente' :
                          status === 'expired' ? 'Caducado' : 'Estado desconocido'}
                      </span>
                    </div>
                    <svg className="w-5 h-5 text-zinc-300 group-hover:text-[#e3000f] transition" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                    </svg>
                  </div>
                </button>
                  )
                })()
              ))}
            </div>
          )}

          {result.ok && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-400">
                {result.cookie_count} cookies
                {checkedAt ? ` · verificado a las ${checkedAt}` : ' · sesión restaurada'}
              </p>
              <button
                onClick={() => { clearSession(); setCookie(''); reset() }}
                className="text-xs text-zinc-400 hover:text-red-500 transition"
              >
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      )}

      {/* Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-sm text-amber-800 flex gap-3">
        <svg className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
        </svg>
        <div>
          <p className="font-semibold mb-0.5">Sesión de corta duración</p>
          <p className="text-amber-700">
            La cookie expira en minutos. Cópiala justo antes de reservar y actúa de inmediato.
          </p>
        </div>
      </div>
    </div>
  )
}
