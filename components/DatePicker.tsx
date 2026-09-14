'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { PassInfo, RouteConfig } from '@/context/SessionContext'
import { useSession } from '@/context/SessionContext'

interface Props {
  pass: PassInfo | null
  passCode: string
}

const DAYS_ES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

function parsePassDate(s: string): Date | null {
  const parts = s.split('/')
  if (parts.length !== 3) return null
  const d = new Date(+parts[2], +parts[1] - 1, +parts[0])
  d.setHours(0, 0, 0, 0)
  return d
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDisplay(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y}`
}

// Preset routes — extend as needed
const PRESET_ROUTES = [
  {
    label: 'Valladolid → Madrid-Chamartín',
    originName: 'VALLADOLID-CAMPO GRANDE',
    originCode: '10600',
    destinationName: 'MADRID-CHAMARTÍN-CLARA CA',
    destinationCode: '17000',
  },
  {
    label: 'Madrid-Chamartín → Valladolid',
    originName: 'MADRID-CHAMARTÍN-CLARA CA',
    originCode: '17000',
    destinationName: 'VALLADOLID-CAMPO GRANDE',
    destinationCode: '10600',
  },
]

export default function DatePicker({ pass, passCode }: Props) {
  const router = useRouter()
  const { session, updateSession } = useSession()

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Restore previously chosen dates if we're coming back from schedule page
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(session?.selectedDates ?? [])
  )

  // Restore or default route
  const [route, setRoute] = useState<RouteConfig>(() =>
    session?.route ?? {
      originName: PRESET_ROUTES[0].originName,
      originCode: PRESET_ROUTES[0].originCode,
      destinationName: PRESET_ROUTES[0].destinationName,
      destinationCode: PRESET_ROUTES[0].destinationCode,
    }
  )
  const [customRoute, setCustomRoute] = useState(false)

  // Calendar view
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  const passStart = pass ? parsePassDate(pass.start) : null
  const passEnd   = pass ? parsePassDate(pass.end)   : null

  const isSelectable = useCallback((d: Date): boolean => {
    if (d < today) return false
    if (passStart && d < passStart) return false
    if (passEnd   && d > passEnd)   return false
    return true
  }, [today, passStart, passEnd])

  function toggleDate(ymd: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(ymd) ? next.delete(ymd) : next.add(ymd)
      return next
    })
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const firstDay = new Date(viewYear, viewMonth, 1)
  const startDow = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (Date | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(viewYear, viewMonth, i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const sortedSelected = [...selected].sort()

  function toggleWeekdays() {
    const days = cells
      .filter((d): d is Date => d !== null && d.getDay() !== 0 && d.getDay() !== 6 && isSelectable(d))
      .map(toYMD)
    const allSel = days.every(d => selected.has(d))
    setSelected(prev => {
      const next = new Set(prev)
      allSel ? days.forEach(d => next.delete(d)) : days.forEach(d => next.add(d))
      return next
    })
  }

  function handleContinue() {
    const dates = sortedSelected
    updateSession({ selectedDates: dates, selectedPassCode: passCode, route })
    router.push(`/schedule/${encodeURIComponent(passCode)}`)
  }

  function applyPreset(idx: number) {
    const p = PRESET_ROUTES[idx]
    setRoute({
      originName: p.originName,
      originCode: p.originCode,
      destinationName: p.destinationName,
      destinationCode: p.destinationCode,
    })
  }

  const canContinue = selected.size > 0

  return (
    <div className="space-y-4">
      {/* Route selector */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 space-y-3">
        <h3 className="text-sm font-semibold text-zinc-800">Trayecto</h3>

        {!customRoute && (
          <div className="flex flex-wrap gap-2">
            {PRESET_ROUTES.map((p, i) => {
              const active =
                route.originCode === p.originCode &&
                route.destinationCode === p.destinationCode
              return (
                <button
                  key={i}
                  onClick={() => applyPreset(i)}
                  className={`text-xs px-3 py-1.5 rounded-full border font-medium transition
                    ${active
                      ? 'bg-[#e3000f] text-white border-[#e3000f]'
                      : 'border-zinc-200 text-zinc-600 hover:border-zinc-400'}`}
                >
                  {p.label}
                </button>
              )
            })}
            <button
              onClick={() => setCustomRoute(true)}
              className="text-xs px-3 py-1.5 rounded-full border border-dashed border-zinc-300
                text-zinc-400 hover:border-zinc-500 hover:text-zinc-600 transition"
            >
              Otro…
            </button>
          </div>
        )}

        {customRoute && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Origen (nombre)</label>
                <input
                  value={route.originName}
                  onChange={e => setRoute(r => ({ ...r, originName: e.target.value }))}
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-1.5
                    focus:outline-none focus:ring-2 focus:ring-[#e3000f]"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Origen (código)</label>
                <input
                  value={route.originCode}
                  onChange={e => setRoute(r => ({ ...r, originCode: e.target.value }))}
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-1.5
                    focus:outline-none focus:ring-2 focus:ring-[#e3000f]"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Destino (nombre)</label>
                <input
                  value={route.destinationName}
                  onChange={e => setRoute(r => ({ ...r, destinationName: e.target.value }))}
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-1.5
                    focus:outline-none focus:ring-2 focus:ring-[#e3000f]"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Destino (código)</label>
                <input
                  value={route.destinationCode}
                  onChange={e => setRoute(r => ({ ...r, destinationCode: e.target.value }))}
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-1.5
                    focus:outline-none focus:ring-2 focus:ring-[#e3000f]"
                />
              </div>
            </div>
            <button
              onClick={() => setCustomRoute(false)}
              className="text-xs text-zinc-400 hover:text-zinc-600 transition"
            >
              ← Volver a rutas rápidas
            </button>
          </div>
        )}
      </div>

      {/* Calendar */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 transition text-zinc-500">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/>
            </svg>
          </button>
          <h3 className="font-semibold text-zinc-800">{MONTHS_ES[viewMonth]} {viewYear}</h3>
          <button onClick={nextMonth}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 transition text-zinc-500">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-7 mb-1">
          {DAYS_ES.map((d, i) => (
            <div key={d} className={`text-center text-xs font-medium py-1
              ${i >= 5 ? 'text-zinc-400' : 'text-zinc-500'}`}>{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((day, idx) => {
            if (!day) return <div key={idx} />
            const ymd = toYMD(day)
            const sel = selected.has(ymd)
            const selectable = isSelectable(day)
            const isToday = toYMD(day) === toYMD(today)
            const isWeekend = day.getDay() === 0 || day.getDay() === 6
            return (
              <button
                key={ymd}
                onClick={() => selectable && toggleDate(ymd)}
                disabled={!selectable}
                aria-pressed={sel}
                className={`relative mx-auto w-9 h-9 rounded-full text-sm font-medium
                  flex items-center justify-center transition
                  ${!selectable
                    ? 'text-zinc-300 cursor-not-allowed'
                    : sel
                      ? 'bg-[#e3000f] text-white shadow-sm hover:bg-red-700'
                      : isToday
                        ? 'ring-2 ring-[#e3000f] text-[#e3000f] hover:bg-red-50'
                        : isWeekend
                          ? 'text-zinc-400 hover:bg-zinc-50'
                          : 'text-zinc-700 hover:bg-zinc-100'
                  }`}
              >
                {day.getDate()}
              </button>
            )
          })}
        </div>

        <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center gap-2">
          <button onClick={toggleWeekdays}
            className="text-xs text-zinc-500 hover:text-zinc-800 underline underline-offset-2 transition">
            L–V de este mes
          </button>
          {selected.size > 0 && (
            <>
              <span className="text-zinc-300">·</span>
              <button onClick={() => setSelected(new Set())}
                className="text-xs text-zinc-400 hover:text-zinc-600 transition">
                Limpiar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Selected summary + continue */}
      {canContinue && (
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 space-y-3">
          <p className="text-sm font-semibold text-zinc-800">
            {selected.size} {selected.size === 1 ? 'fecha seleccionada' : 'fechas seleccionadas'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sortedSelected.map(ymd => (
              <span key={ymd}
                className="inline-flex items-center gap-1 bg-red-50 text-[#e3000f] text-xs
                  font-medium px-2.5 py-1 rounded-full border border-red-100">
                {formatDisplay(ymd)}
                <button onClick={() => toggleDate(ymd)} aria-label={`Quitar ${formatDisplay(ymd)}`}
                  className="hover:text-red-800 transition">
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                  </svg>
                </button>
              </span>
            ))}
          </div>

          <button
            onClick={handleContinue}
            className="w-full bg-[#e3000f] text-white text-sm font-semibold py-2.5 rounded-xl
              shadow hover:bg-red-700 active:bg-red-800 transition"
          >
            Ver trenes para {selected.size} {selected.size === 1 ? 'fecha' : 'fechas'} →
          </button>
        </div>
      )}

      {pass && (
        <p className="text-xs text-zinc-400 text-center">
          Pase válido {pass.start} – {pass.end}
        </p>
      )}
    </div>
  )
}
