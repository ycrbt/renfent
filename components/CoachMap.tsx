'use client'

import type { Coach, Seat } from '@/lib/renfe'

interface Props {
  coach: Coach
  selected: string | null
  onSelect: (seatId: string) => void
}

function seatColor(seat: Seat, selected: boolean): string {
  if (seat.status === 'unavailable') return 'bg-zinc-100 border-zinc-200 cursor-not-allowed text-zinc-300'
  if (seat.status === 'occupied')    return 'bg-zinc-200 border-zinc-300 cursor-not-allowed text-zinc-400'
  if (selected) return 'bg-[#e3000f] border-[#e3000f] text-white shadow-md scale-105'
  // Free seats — colour by type
  switch (seat.type) {
    case 'Pasillo':           return 'bg-sky-50 border-sky-300 text-sky-700 hover:bg-sky-100 hover:border-sky-400 cursor-pointer'
    case 'Pasillo, con Mesa': return 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100 cursor-pointer'
    case 'Ventanilla':        return 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100 cursor-pointer'
    case 'Centro':            return 'bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100 cursor-pointer'
    default:                  return 'bg-zinc-50 border-zinc-300 text-zinc-600 hover:bg-zinc-100 cursor-pointer'
  }
}

export default function CoachMap({ coach, selected, onSelect }: Props) {
  const pickerSeats = coach.seats.filter(seat => seat.letter !== 'H' && !/H$/i.test(seat.id))
  // Group seats by row
  const byRow = new Map<number, Seat[]>()
  const numericOnly = pickerSeats.length > 0 && pickerSeats.every(seat => /^\d+$/.test(seat.id))
  if (numericOnly) {
    const positions = ['A', 'B', 'C', 'D']
    const ordered = [...pickerSeats].sort((a, b) => Number(a.id) - Number(b.id))
    for (let index = 0; index < ordered.length; index++) {
      const row = Math.floor(index / 4) + 1
      const arr = byRow.get(row) ?? []
      arr.push({ ...ordered[index], row, letter: positions[index % 4] })
      byRow.set(row, arr)
    }
  } else {
    for (const seat of pickerSeats) {
      const arr = byRow.get(seat.row) ?? []
      arr.push(seat)
      byRow.set(seat.row, arr)
    }
  }
  const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0])

  const letters = [...new Set([...byRow.values()].flat().map(seat => seat.letter))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
  let leftLetters: string[]
  let rightLetters: string[]
  if (letters.includes('F')) {
    // Renfe 2+2 composition: A C | D F.
    leftLetters = letters.filter(letter => ['A', 'B', 'C'].includes(letter))
    rightLetters = letters.filter(letter => ['D', 'E', 'F'].includes(letter))
  } else if (letters.includes('E')) {
    // Renfe 2+3 composition: A B | C D E.
    leftLetters = letters.filter(letter => ['A', 'B'].includes(letter))
    rightLetters = letters.filter(letter => ['C', 'D', 'E'].includes(letter))
  } else {
    // Preserve uncommon compositions instead of dropping unknown seat letters.
    const split = Math.ceil(letters.length / 2)
    leftLetters = letters.slice(0, split)
    rightLetters = letters.slice(split)
  }

  const freeSeatCount = pickerSeats.filter(s => s.status === 'free').length

  return (
    <div>
      {/* Coach header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full
            bg-zinc-800 text-white text-xs font-bold">{coach.number}</span>
          <span className="text-xs text-zinc-500 font-medium">Vagón {coach.number}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium
          ${freeSeatCount > 0 ? 'bg-sky-50 text-sky-600' : 'bg-zinc-100 text-zinc-400'}`}>
          {freeSeatCount} libres
        </span>
      </div>

      {/* Direction header */}
      <div className="flex items-center justify-between text-xs text-zinc-400 mb-1 px-1">
        <div className="flex items-center gap-1">
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 6h8M7 3l3 3-3 3"/>
          </svg>
          <span>Frente del tren</span>
        </div>
        <div className="flex items-center gap-1">
          <span>Parte trasera</span>
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 6H2M5 3L2 6l3 3"/>
          </svg>
        </div>
      </div>

      {/* Seat rows run left-to-right, matching the direction of the train. */}
      <div className="flex w-max items-start gap-1 pb-2">
        {rows.map(([rowNum, seats]) => {
          // Fill sparse rows while preserving this coach's actual composition.
          const seatByLetter: Record<string, Seat | undefined> = {}
          for (const s of seats) seatByLetter[s.letter] = s

          return (
            <div key={rowNum} className="w-8 flex-none space-y-0.5">
              {/* Row number */}
              <div className="h-5 flex items-center justify-center">
                <span className="text-xs text-zinc-300 tabular-nums">{String(rowNum).padStart(2, '0')}</span>
              </div>

              {leftLetters.map(letter => (
                <SeatCell key={letter} seat={seatByLetter[letter]} selected={selected} onSelect={onSelect} />
              ))}

              {/* Aisle gap */}
              <div className="h-3 flex items-center justify-center">
                <div className="h-0.5 w-6 bg-zinc-100 rounded-full" />
              </div>

              {rightLetters.map(letter => (
                <SeatCell key={letter} seat={seatByLetter[letter]} selected={selected} onSelect={onSelect} />
              ))}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-zinc-100">
        {[
          { color: 'bg-sky-200 border-sky-300', label: 'Pasillo' },
          { color: 'bg-emerald-200 border-emerald-300', label: 'Ventanilla' },
          { color: 'bg-violet-200 border-violet-300', label: 'Centro' },
          { color: 'bg-amber-200 border-amber-300', label: 'Pasillo c/ mesa' },
          { color: 'bg-zinc-200 border-zinc-300', label: 'Ocupado' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`inline-block w-3 h-3 rounded-sm border ${color}`} />
            <span className="text-xs text-zinc-400">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-[#e3000f]" />
          <span className="text-xs text-zinc-400">Seleccionado</span>
        </div>
      </div>
    </div>
  )
}

function SeatCell({
  seat,
  selected,
  onSelect,
}: {
  seat: Seat | undefined
  selected: string | null
  onSelect: (id: string) => void
}) {
  if (!seat) {
    // Empty cell (no seat at this position in this row)
    return <div className="w-8 h-8 flex-shrink-0" />
  }

  const isSel = selected === seat.id
  const isClickable = seat.status === 'free'

  return (
    <button
      onClick={() => isClickable && onSelect(seat.id)}
      disabled={!isClickable}
      title={`${seat.id} · ${seat.type}${seat.direction !== 'unknown' ? ' · ' + (seat.direction === 'forward' ? 'Sentido marcha' : 'Sentido inverso') : ''}`}
      aria-pressed={isSel}
      className={`relative w-8 h-8 flex-shrink-0 rounded-md border text-xs font-semibold
        flex flex-col items-center justify-center transition-all duration-150
        ${seatColor(seat, isSel)}`}
    >
      <span className="leading-none">{/^\d+$/.test(seat.id) ? seat.id : seat.letter}</span>
      {/* Direction pip */}
      {seat.direction !== 'unknown' && seat.status === 'free' && (
        <span
          className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full
            ${isSel ? 'bg-white/60' : seat.direction === 'forward' ? 'bg-sky-400' : 'bg-zinc-400'}`}
        />
      )}
    </button>
  )
}
