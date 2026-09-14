import { NextRequest } from 'next/server'
import {
  Session,
  fetchTrainsForDate,
  type PassConfig,
} from '@/lib/renfe'

export const maxDuration = 60 // seconds — Vercel/Node limit per request

export async function POST(req: NextRequest) {
  let cookie: string, dates: string[], pass: PassConfig,
    origin: { name: string; code: string },
    destination: { name: string; code: string }

  try {
    const body = await req.json()
    cookie      = String(body.cookie ?? '').trim()
    dates       = Array.isArray(body.dates) ? body.dates : []
    pass        = body.pass
    origin      = body.origin
    destination = body.destination
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 })
  }

  if (!cookie || !dates.length || !pass || !origin || !destination) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 })
  }

  if (cookie.toLowerCase().startsWith('cookie:')) {
    cookie = cookie.slice(cookie.indexOf(':') + 1).trim()
  }

  try {
    new Session(cookie)
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 400 })
  }

  // Run independent date lookups together and stream each result on completion.
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const requests = dates.map(async ymd => {
        const [y, m, d] = ymd.split('-').map(Number)
        const date = new Date(y, m - 1, d)
        const session = new Session(cookie)
        const result = await fetchTrainsForDate(session, pass, date, origin, destination)
        controller.enqueue(encoder.encode(JSON.stringify(result) + '\n'))
      })
      await Promise.all(requests)
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
    },
  })
}
