'use client'

import { use, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/context/SessionContext'

interface TrainOption {
  cdgoTren: string
  departure: string
  arrival: string
  duration: string
  bookable: boolean
  seatsLeft: number
  class: string
}

interface DateTrains {
  date: string      // yyyy-mm-dd
  trains: TrainOption[]
  error?: string
}

type SelectionMap = Record<string, string>  // date -> departure time

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  const date = new Date(+y, +m - 1, +d)
  return date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
}

function formatDep(dep: string): string {
  return dep.replace('.', ':')
}

export default function SchedulePage({ params }: { params: Promise<{ passCode: string }> }) {
  const { passCode } = use(params)
  const router = useRouter()
  const { session, updateSession } = useSession()

  const [results, setResults] = useState<DateTrains[]>([])
  const [loading, setLoading] = useState(true)
  const [selections, setSelections] = useState<SelectionMap>({})
  const [openDate, setOpenDate] = useState<string | null>(null)
  const [retryingDates, setRetryingDates] = useState<Set<string>>(() => new Set())
  const abortRef = useRef<AbortController | null>(null)
  const openedFirstResultRef = useRef(false)

  const decodedCode = decodeURIComponent(passCode)
  const pass = session?.passes.find(p => p.code === decodedCode)
  const dates = session?.selectedDates ?? []
  const route = session?.route

  useEffect(() => {
    if (!session || !pass || !dates.length || !route) return

    abortRef.current = new AbortController()
    setLoading(true)
    setResults([])

    async function fetchAll() {
      try {
        const res = await fetch('/api/list-trains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cookie: session!.cookie,
            dates,
            pass: {
              code: pass!.code,
              localiza: pass!.localiza,
              type: pass!.type,
              title: pass!.title,
            },
            origin: {
              name: route!.originName,
              code: route!.originCode,
            },
            destination: {
              name: route!.destinationName,
              code: route!.destinationCode,
            },
          }),
          signal: abortRef.current!.signal,
        })

        if (!res.body) throw new Error('No response body')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const item: DateTrains = JSON.parse(line)
              setResults(prev => [...prev, item])
              if (!openedFirstResultRef.current) {
                openedFirstResultRef.current = true
                setOpenDate(item.date)
              }
            } catch {}
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          setResults(prev => [
            ...prev,
            ...dates
              .filter(date => !prev.some(item => item.date === date))
              .map(date => ({ date, trains: [], error: `Error de red: ${e.message}` })),
          ])
        }
      } finally {
        setLoading(false)
      }
    }

    fetchAll()
    return () => abortRef.current?.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function selectTrain(date: string, departure: string) {
    setSelections(prev => ({
      ...prev,
      [date]: prev[date] === departure ? '' : departure,
    }))
  }

  async function retryDate(date: string) {
    if (!session || !pass || !route) return
    setRetryingDates(previous => new Set(previous).add(date))
    try {
      const res = await fetch('/api/list-trains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookie: session.cookie,
          dates: [date],
          pass: { code: pass.code, localiza: pass.localiza, type: pass.type, title: pass.title },
          origin: { name: route.originName, code: route.originCode },
          destination: { name: route.destinationName, code: route.destinationCode },
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const line = (await res.text()).split('\n').find(value => value.trim())
      if (!line) throw new Error('Renfe no devolvió una respuesta')
      const result: DateTrains = JSON.parse(line)
      setResults(previous => [...previous.filter(item => item.date !== date), result])
    } catch (retryError) {
      setResults(previous => [
        ...previous.filter(item => item.date !== date),
        { date, trains: [], error: retryError instanceof Error ? retryError.message : 'Error de red' },
      ])
    } finally {
      setRetryingDates(previous => {
        const next = new Set(previous)
        next.delete(date)
        return next
      })
    }
  }

  const datesWithTrains = results.filter(r => r.trains.length > 0)
  const allDatesLoaded = results.length === dates.length

  // How many dates have a valid selection
  const selectedCount = Object.values(selections).filter(Boolean).length
  const datesNeedingSelection = datesWithTrains.length

  if (!session) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-8 text-center space-y-3">
        <p className="text-zinc-600 text-sm">Sesión no encontrada.</p>
        <button onClick={() => router.push('/')} className="text-[#e3000f] text-sm font-medium hover:underline">
          ← Volver al inicio
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <button onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 transition mb-4">
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/>
          </svg>
          Volver
        </button>

        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm px-5 py-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="font-semibold text-zinc-800 text-sm">
                {route?.originName} → {route?.destinationName}
              </p>
              <p className="text-xs text-zinc-400">{pass?.title || decodedCode} · {dates.length} fechas</p>
            </div>
            {loading && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="inline-block w-3.5 h-3.5 border-2 border-zinc-300 border-t-[#e3000f] rounded-full animate-spin" />
                Consultando {results.length}/{dates.length}…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {dates.map(date => {
        const result = results.find(item => item.date === date)
        if (!result) return (
          <div key={date}
            className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-zinc-200 border-t-zinc-400 animate-spin flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-zinc-800">{formatDate(date)}</p>
                <p className="text-xs text-zinc-400">Consultando trenes…</p>
              </div>
            </div>
          </div>
        )
        const { trains, error } = result
        return (
        <div key={date} className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          {/* Date header */}
          <button
            type="button"
            onClick={() => setOpenDate(current => current === date ? null : date)}
            aria-expanded={openDate === date}
            aria-controls={`trains-${date}`}
            className={`w-full px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-zinc-50 transition
              ${openDate === date ? 'border-b border-zinc-100' : ''}`}
          >
            <p className="font-semibold text-zinc-800 text-sm capitalize">{formatDate(date)}</p>
            <span className="flex items-center gap-2">
              {error ? (
                <span className="text-xs text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Error</span>
              ) : trains.length === 0 ? (
                <span className="text-xs text-zinc-400 bg-zinc-50 px-2 py-0.5 rounded-full">Sin trenes</span>
              ) : selections[date] ? (
                <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                  {formatDep(selections[date])} seleccionado
                </span>
              ) : (
                <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Elige un tren</span>
              )}
              <span aria-hidden="true" className={`text-zinc-400 transition-transform ${openDate === date ? 'rotate-180' : ''}`}>⌄</span>
            </span>
          </button>

          {openDate === date && (
            <div
              id={`trains-${date}`}
              className={trains.length > 0 && !error
                ? 'h-80 overflow-y-auto overscroll-contain'
                : 'min-h-24'}
            >
              {error ? (
            <div className="min-h-24 px-5 py-4 flex items-center justify-center text-center">
              <div>
                <p className="text-sm text-red-600">{error}</p>
                <button type="button" onClick={() => retryDate(date)} disabled={retryingDates.has(date)}
                  className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                  {retryingDates.has(date) ? 'Reintentando…' : 'Reintentar'}
                </button>
              </div>
            </div>
          ) : trains.length === 0 ? (
            <div className="min-h-24 px-5 py-4 flex items-center justify-center text-center">
              <div>
                <p className="text-sm font-medium text-zinc-600">No hay trenes disponibles</p>
                <p className="mt-1 text-xs text-zinc-400">Renfe no devolvió servicios para esta fecha.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-zinc-50">
              {trains.map(train => {
                const sel = selections[date] === train.departure
                return (
                  <button
                    key={train.cdgoTren}
                    onClick={() => train.bookable && selectTrain(date, train.departure)}
                    disabled={!train.bookable}
                    className={`w-full text-left px-5 py-3 flex items-center gap-4 transition
                      ${!train.bookable
                        ? 'opacity-40 cursor-not-allowed'
                        : sel
                          ? 'bg-red-50'
                          : 'hover:bg-zinc-50'
                      }`}
                  >
                    {/* Selection indicator */}
                    <span className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition
                      ${sel
                        ? 'border-[#e3000f] bg-[#e3000f]'
                        : train.bookable
                          ? 'border-zinc-300'
                          : 'border-zinc-200'
                      }`}>
                      {sel && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </span>

                    {/* Times */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className={`text-base font-bold tabular-nums
                          ${sel ? 'text-[#e3000f]' : 'text-zinc-800'}`}>
                          {formatDep(train.departure)}
                        </span>
                        <span className="text-zinc-300 text-xs">→</span>
                        <span className="text-sm font-medium text-zinc-600 tabular-nums">
                          {formatDep(train.arrival)}
                        </span>
                        {train.duration && (
                          <span className="text-xs text-zinc-400 ml-1">{train.duration}</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400">Tren {train.cdgoTren}</p>
                    </div>

                    {/* Seats */}
                    <div className="text-right flex-shrink-0">
                      {train.bookable ? (
                        <>
                          <p className="text-xs font-semibold text-emerald-600">{train.seatsLeft} plazas</p>
                          <p className="text-xs text-zinc-400">{train.class}</p>
                        </>
                      ) : (
                        <p className="text-xs text-zinc-400">No disponible</p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
              )}
            </div>
          )}
        </div>
        )
      })}

      {/* Continue bar — sticky at bottom */}
      {allDatesLoaded && selectedCount > 0 && (
        <div className="sticky bottom-4 pt-2">
          <button
            className="w-full bg-[#e3000f] text-white text-sm font-semibold py-3 rounded-2xl
              shadow-lg hover:bg-red-700 active:bg-red-800 transition"
            onClick={() => {
              updateSession({ trainSelections: selections })
              router.push(`/seats/${encodeURIComponent(passCode)}`)
            }}
          >
            Reservar {selectedCount} {selectedCount === 1 ? 'tren' : 'trenes'} →
          </button>
          {selectedCount < datesNeedingSelection && (
            <p className="text-center text-xs text-zinc-400 mt-2">
              Faltan {datesNeedingSelection - selectedCount} fechas por seleccionar
            </p>
          )}
        </div>
      )}
    </div>
  )
}
