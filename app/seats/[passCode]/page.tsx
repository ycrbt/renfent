'use client'

import { use, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/context/SessionContext'
import CoachMap from '@/components/CoachMap'
import type { SeatMap, BookingResult } from '@/lib/renfe'

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return new Date(+y, +m - 1, +d).toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

function formatDep(dep: string) { return dep.replace('.', ':') }

export default function SeatsPage({ params }: { params: Promise<{ passCode: string }> }) {
  const { passCode } = use(params)
  const router = useRouter()
  const { session } = useSession()

  const [maps, setMaps] = useState<SeatMap[]>([])
  const [loading, setLoading] = useState(true)
  // seatSelections: date -> { coachNumber, seatId }
  const [seatSelections, setSeatSelections] = useState<Record<string, { coach: string; seat: string }>>({})
  const [openDate, setOpenDate] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [booking, setBooking] = useState(false)
  const [bookingTotal, setBookingTotal] = useState(0)
  const [bookingProgress, setBookingProgress] = useState(0)
  const [bookingResults, setBookingResults] = useState<BookingResult[]>([])
  const [bookingError, setBookingError] = useState('')
  const [retryingDates, setRetryingDates] = useState<Set<string>>(() => new Set())
  const abortRef = useRef<AbortController | null>(null)
  const openedFirstMapRef = useRef(false)

  const decodedCode = decodeURIComponent(passCode)
  const pass = session?.passes.find(p => p.code === decodedCode)
  const dates = session?.selectedDates ?? []
  const route = session?.route
  const trainSelections = session?.trainSelections ?? {}
  const selectedDates = dates.filter(d => trainSelections[d])

  useEffect(() => {
    if (!session || !pass || !selectedDates.length || !route) return
    abortRef.current = new AbortController()
    setLoading(true)
    setMaps([])

    async function fetchAll() {
      try {
        const res = await fetch('/api/seat-map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cookie: session!.cookie,
            dates: selectedDates,
            selections: trainSelections,
            pass: { code: pass!.code, localiza: pass!.localiza, type: pass!.type, title: pass!.title },
            origin: { name: route!.originName, code: route!.originCode },
            destination: { name: route!.destinationName, code: route!.destinationCode },
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
              const item: SeatMap = JSON.parse(line)
              setMaps(prev => [...prev, item])
              if (!openedFirstMapRef.current) {
                openedFirstMapRef.current = true
                setOpenDate(item.date)
              }
            } catch {}
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          setMaps(previous => [
            ...previous,
            ...selectedDates
              .filter(date => !previous.some(item => item.date === date))
              .map(date => ({
                date, cdgoTren: '', departure: trainSelections[date], coaches: [], compra: '',
                seatPageFields: {}, error: `Error de red: ${e.message}`,
              })),
          ])
        }
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
    return () => abortRef.current?.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function selectSeat(date: string, coach: string, seat: string) {
    if (booking || bookingResults.some(result => result.date === date && result.committed)) return
    setSeatSelections(prev => {
      const cur = prev[date]
      // deselect if same seat clicked again
      if (cur?.coach === coach && cur?.seat === seat) {
        const next = { ...prev }
        delete next[date]
        return next
      }
      return { ...prev, [date]: { coach, seat } }
    })
  }

  async function retryDate(date: string) {
    if (!session || !pass || !route || !trainSelections[date]) return
    setRetryingDates(previous => new Set(previous).add(date))
    try {
      const res = await fetch('/api/seat-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookie: session.cookie,
          dates: [date],
          selections: trainSelections,
          pass: { code: pass.code, localiza: pass.localiza, type: pass.type, title: pass.title },
          origin: { name: route.originName, code: route.originCode },
          destination: { name: route.destinationName, code: route.destinationCode },
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const line = (await res.text()).split('\n').find(value => value.trim())
      if (!line) throw new Error('Renfe no devolvió una respuesta')
      const result: SeatMap = JSON.parse(line)
      setMaps(previous => [...previous.filter(item => item.date !== date), result])
    } catch (retryError) {
      setMaps(previous => [
        ...previous.filter(item => item.date !== date),
        { date, cdgoTren: '', departure: trainSelections[date], coaches: [], compra: '',
          seatPageFields: {}, error: retryError instanceof Error ? retryError.message : 'Error de red' },
      ])
    } finally {
      setRetryingDates(previous => {
        const next = new Set(previous)
        next.delete(date)
        return next
      })
    }
  }

  async function finishBooking() {
    if (!session || !pass || !route || readyCount === 0) return
    setConfirmOpen(false)
    setBooking(true)
    setBookingError('')
    setBookingResults(previous => previous.filter(result => result.committed))
    try {
      const bookingDates = selectedDates.filter(date =>
        seatSelections[date] && !bookingResults.some(result => result.date === date && result.committed))
      setBookingTotal(bookingDates.length)
      setBookingProgress(0)
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookie: session.cookie,
          dates: bookingDates,
          trainSelections,
          seatSelections,
          pass: { code: pass.code, localiza: pass.localiza, type: pass.type, title: pass.title },
          origin: { name: route.originName, code: route.originCode },
          destination: { name: route.destinationName, code: route.destinationCode },
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
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
          const result: BookingResult = JSON.parse(line)
          setBookingResults(previous => [
            ...previous.filter(item => item.date !== result.date),
            result,
          ])
          setBookingProgress(previous => previous + 1)
        }
      }
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : 'No se pudo completar la reserva.')
    } finally {
      setBooking(false)
    }
  }

  const allLoaded = maps.length === selectedDates.length
  const readyCount = Object.keys(seatSelections).length
  const committedDates = new Set(bookingResults.filter(result => result.committed).map(result => result.date))
  const pendingBookingCount = Object.keys(seatSelections).filter(date => !committedDates.has(date)).length
  const totalDates = maps.filter(m => !m.error && m.coaches.length > 0).length

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
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div>
        <button onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 transition mb-4">
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/>
          </svg>
          Volver
        </button>
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm px-5 py-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-zinc-800 text-sm">Selección de asiento</p>
            <p className="text-xs text-zinc-400">{selectedDates.length} fechas · {route?.originName} → {route?.destinationName}</p>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="inline-block w-3.5 h-3.5 border-2 border-zinc-300 border-t-[#e3000f] rounded-full animate-spin"/>
              {maps.length}/{selectedDates.length}
            </div>
          )}
        </div>
      </div>

      {/* Seat maps */}
      {selectedDates.map(date => {
        const seatMap = maps.find(item => item.date === date)
        if (!seatMap) return (
          <div key={date} className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 animate-pulse">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-4 h-4 rounded-full border-2 border-zinc-200 border-t-zinc-400 animate-spin flex-shrink-0"/>
              <div>
                <p className="text-sm font-semibold text-zinc-800 capitalize">{formatDate(date)}</p>
                <p className="text-xs text-zinc-400">Cargando mapa de asientos…</p>
              </div>
            </div>
            <div className="h-32 bg-zinc-100 rounded-xl"/>
          </div>
        )
        const sel = seatSelections[seatMap.date]
        const booked = bookingResults.find(result => result.date === seatMap.date)
        return (
          <div key={seatMap.date} className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            {/* Date + train header */}
            <button
              type="button"
              onClick={() => setOpenDate(current => current === seatMap.date ? null : seatMap.date)}
              aria-expanded={openDate === seatMap.date}
              aria-controls={`seats-${seatMap.date}`}
              className={`w-full px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-zinc-50 transition
                ${openDate === seatMap.date ? 'border-b border-zinc-100' : ''}`}
            >
              <div>
                <p className="font-semibold text-zinc-800 text-sm capitalize">{formatDate(seatMap.date)}</p>
                <p className="text-xs text-zinc-400">
                  Tren {seatMap.cdgoTren} · salida {formatDep(seatMap.departure)}
                </p>
              </div>
              <span className="flex items-center gap-2">
                {booked?.committed ? (
                  <span className="text-xs text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full font-medium">
                    Reservado · {booked.locator ?? 'confirmado'}
                  </span>
                ) : booked?.error ? (
                  <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Reserva fallida</span>
                ) : seatMap.error ? (
                  <span className="text-xs text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Error</span>
                ) : sel ? (
                  <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                    Vagón {sel.coach} · {sel.seat}
                  </span>
                ) : (
                  <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Elige asiento</span>
                )}
                <span aria-hidden="true" className={`text-zinc-400 transition-transform ${openDate === seatMap.date ? 'rotate-180' : ''}`}>⌄</span>
              </span>
            </button>

            {openDate === seatMap.date && <div id={`seats-${seatMap.date}`}>{seatMap.error ? (
              <div className="px-5 py-4">
                <p className="text-sm text-red-600">{seatMap.error}</p>
                <button type="button" onClick={() => retryDate(seatMap.date)} disabled={retryingDates.has(seatMap.date)}
                  className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                  {retryingDates.has(seatMap.date) ? 'Reintentando…' : 'Reintentar'}
                </button>
              </div>
            ) : (
              <div
                className="w-[80vw] max-w-full overflow-x-auto overscroll-x-contain touch-pan-x p-4"
                aria-label={`Vagones del tren del ${formatDate(seatMap.date)}`}
              >
                <div className="flex w-max gap-4">
                  {seatMap.coaches.map(coach => (
                    <div key={coach.number}
                      className="flex-none rounded-xl border border-zinc-100 bg-white p-4">
                      <CoachMap
                        coach={coach}
                        selected={sel?.coach === coach.number ? sel.seat : null}
                        onSelect={(seatId) => selectSeat(seatMap.date, coach.number, seatId)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}</div>}
            {booked?.error && (
              <p className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{booked.error}</p>
            )}
          </div>
        )
      })}

      {/* Sticky confirm bar */}
      {allLoaded && pendingBookingCount > 0 && (
        <div className="fixed bottom-4 left-0 right-0 flex justify-center px-4 z-10">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-zinc-200 p-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-800">
                {readyCount} de {totalDates} asientos seleccionados
              </p>
              {readyCount < totalDates && (
                <p className="text-xs text-zinc-400">Faltan {totalDates - readyCount} por elegir</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={booking}
              className="flex-shrink-0 bg-[#e3000f] text-white text-sm font-semibold
                px-5 py-2.5 rounded-xl shadow hover:bg-red-700 active:bg-red-800 transition disabled:opacity-50"
            >
              {booking ? `Reservando ${bookingProgress}/${bookingTotal}…` :
                `Reservar ${pendingBookingCount} ${pendingBookingCount === 1 ? 'asiento' : 'asientos'} →`}
            </button>
          </div>
        </div>
      )}

      {bookingError && (
        <div role="alert" className="fixed bottom-28 left-1/2 z-20 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-lg">
          {bookingError}
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="booking-confirm-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 id="booking-confirm-title" className="text-lg font-semibold text-zinc-900">Confirmar reservas</h2>
            <p className="mt-2 text-sm text-zinc-600">
              Se crearán {pendingBookingCount} {pendingBookingCount === 1 ? 'reserva real' : 'reservas reales'} en Renfe.
              La disponibilidad de cada asiento se comprobará de nuevo antes de reservarlo.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmOpen(false)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-100">
                Cancelar
              </button>
              <button type="button" onClick={finishBooking}
                className="rounded-xl bg-[#e3000f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
                Confirmar y reservar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
