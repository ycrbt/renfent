import { NextRequest } from 'next/server'
import { Session, fetchSeatMap, type PassConfig } from '@/lib/renfe'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  let cookie: string,
    dates: string[],
    selections: Record<string, string>,
    pass: PassConfig,
    origin: { name: string; code: string },
    destination: { name: string; code: string }

  try {
    const body = await req.json()
    cookie     = String(body.cookie ?? '').trim()
    dates      = Array.isArray(body.dates) ? body.dates : []
    selections = body.selections ?? {}
    pass       = body.pass
    origin     = body.origin
    destination = body.destination
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 })
  }

  if (cookie.toLowerCase().startsWith('cookie:')) {
    cookie = cookie.slice(cookie.indexOf(':') + 1).trim()
  }

  try { new Session(cookie) }
  catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 400 }) }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // Renfe stores the active purchase in the authenticated server session.
      // Date flows must finish one at a time even when using separate JS clients.
      for (const ymd of dates) {
        const departure = selections[ymd]
        if (!departure) continue
        const [y, m, d] = ymd.split('-').map(Number)
        const date = new Date(y, m - 1, d)
        const session = new Session(cookie)
        const result = await fetchSeatMap(session, pass, date, departure, origin, destination)
        controller.enqueue(encoder.encode(JSON.stringify(result) + '\n'))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  })
}
