import { NextRequest, NextResponse } from 'next/server'
import { Session, checkSession, fetchPasses, BookingError, DwrError } from '@/lib/renfe'

export async function POST(req: NextRequest) {
  let cookie: string
  try {
    const body = await req.json()
    cookie = String(body.cookie ?? '').trim()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request body.' }, { status: 400 })
  }

  if (!cookie) {
    return NextResponse.json({ ok: false, message: 'No cookie provided.' }, { status: 400 })
  }

  // Strip leading "Cookie:" prefix if the user copied the full header line
  if (cookie.toLowerCase().startsWith('cookie:')) {
    cookie = cookie.slice(cookie.indexOf(':') + 1).trim()
  }

  let session: Session
  try {
    session = new Session(cookie)
  } catch (e) {
    return NextResponse.json({ ok: false, message: String(e) }, { status: 400 })
  }

  try {
    await checkSession(session)
  } catch (e) {
    if (e instanceof BookingError || e instanceof DwrError) {
      return NextResponse.json({
        ok: false,
        message: e.message,
        cookie_count: session.entries.length,
        passes: [],
      })
    }
    throw e
  }

  // Best-effort pass list — don't fail the whole check if this errors
  let passes: Awaited<ReturnType<typeof fetchPasses>> = []
  try {
    passes = await fetchPasses(session)
  } catch {}

  return NextResponse.json({
    ok: true,
    message: 'Sesión activa en venta.renfe.com.',
    cookie_count: session.entries.length,
    passes,
  })
}
