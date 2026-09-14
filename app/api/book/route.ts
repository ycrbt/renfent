import { NextRequest } from 'next/server'
import { Session, commitSelectedSeat, type PassConfig } from '@/lib/renfe'

export const maxDuration = 120

interface SeatSelection {
  coach: string
  seat: string
}

export async function POST(req: NextRequest) {
  let cookie: string
  let dates: string[]
  let trainSelections: Record<string, string>
  let seatSelections: Record<string, SeatSelection>
  let pass: PassConfig
  let origin: { name: string; code: string }
  let destination: { name: string; code: string }

  try {
    const body = await req.json()
    cookie = String(body.cookie ?? '').trim()
    dates = Array.isArray(body.dates) ? body.dates.map(String) : []
    trainSelections = body.trainSelections ?? {}
    seatSelections = body.seatSelections ?? {}
    pass = body.pass
    origin = body.origin
    destination = body.destination
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (cookie.toLowerCase().startsWith('cookie:')) {
    cookie = cookie.slice(cookie.indexOf(':') + 1).trim()
  }
  const bookedDates = dates.filter(date => trainSelections[date] && seatSelections[date])
  if (!cookie || !bookedDates.length || !pass || !origin || !destination) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }
  try { new Session(cookie) }
  catch (error) { return Response.json({ error: String(error) }, { status: 400 }) }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // Committing is stateful in Renfe and may partially succeed, so preserve order.
      for (const ymd of bookedDates) {
        const [year, month, day] = ymd.split('-').map(Number)
        const result = await commitSelectedSeat(
          new Session(cookie),
          pass,
          new Date(year, month - 1, day),
          trainSelections[ymd],
          origin,
          destination,
          seatSelections[ymd],
        )
        if (!result.committed) {
          console.error('[Renfent booking]', {
            date: ymd,
            departure: trainSelections[ymd],
            coach: seatSelections[ymd].coach,
            seat: seatSelections[ymd].seat,
            error: result.error,
          })
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(result)}\n`))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  })
}
