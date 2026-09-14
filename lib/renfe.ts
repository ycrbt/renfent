/**
 * Cookie-carrying HTTP session for venta.renfe.com — port of the Session class
 * in renfe_book.py. Runs server-side only (Next.js server actions / route handlers).
 *
 * Key behaviour:
 *  - Cookies kept as ordered raw "name=value" strings (not a Map) because the
 *    F5 persistence cookies repeat the same name with different values.
 *  - Redirects followed manually so Set-Cookie on 3xx responses is captured.
 *  - Two header profiles: "navigate" (document) and "xhr" (DWR / ServletRCD).
 *  - .do form endpoints are ISO-8859-1; DWR endpoints are UTF-8.
 */

import { parseCallback, serialize, DwrError, type JsValue } from './dwr'

const BASE = 'https://venta.renfe.com'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'

export { DwrError }

export class BookingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BookingError'
  }
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** percent-encode a string for a DWR body (RFC 3986 unreserved chars left alone) */
function pct(value: string): string {
  return encodeURIComponent(value)
}

/** Encode a form field value as ISO-8859-1 percent-encoding (like a browser). */
function isoEncode(value: string): string {
  // Encode non-ASCII characters as their ISO-8859-1 percent form.
  // Characters outside ISO-8859-1 are replaced with XML numeric references,
  // matching Python's xmlcharrefreplace behaviour.
  let out = ''
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if (code < 128) {
      // ASCII — use standard percent-encoding for special chars
      out += encodeURIComponent(ch)
    } else if (code <= 0xff) {
      out += '%' + code.toString(16).toUpperCase().padStart(2, '0')
    } else {
      out += `&#${code};`
    }
  }
  return out
}

function formEncode(fields: [string, string][]): string {
  return fields
    .map(([k, v]) => `${encodeURIComponent(k)}=${isoEncode(v)}`)
    .join('&')
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface RequestResult {
  status: number
  url: string
  body: string
}

export class Session {
  entries: string[]

  constructor(cookieHeader: string) {
    this.entries = cookieHeader
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)
    if (!this.entries.length) {
      throw new BookingError('no cookies parsed — check the cookie string')
    }
  }

  get cookies(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const entry of this.entries) {
      if (!entry.includes('=')) continue
      const [name, ...rest] = entry.split('=')
      out[name.trim()] ??= rest.join('=').trim()
    }
    return out
  }

  private cookieHeader(): string {
    return this.entries.join('; ')
  }

  private absorb(setCookieHeaders: string[]): void {
    for (const raw of setCookieHeaders) {
      const pair = raw.split(';')[0].trim()
      if (!pair.includes('=')) continue
      const eqIdx = pair.indexOf('=')
      const name = pair.slice(0, eqIdx).trim()
      const value = pair.slice(eqIdx + 1).trim()
      const index = [...this.entries].reverse().findIndex(
        e => e.split('=')[0].trim() === name
      )
      const realIndex = index === -1 ? -1 : this.entries.length - 1 - index
      if (value === '' || value === '""') {
        if (realIndex !== -1) this.entries.splice(realIndex, 1)
        continue
      }
      if (realIndex === -1) this.entries.push(pair)
      else this.entries[realIndex] = pair
    }
  }

  async request(
    method: string,
    url: string,
    options: {
      data?: string
      referer?: string
      follow?: boolean
      maxHops?: number
      kind?: 'navigate' | 'xhr'
      contentType?: string
    } = {},
  ): Promise<RequestResult> {
    const { data, referer, follow = true, maxHops = 5, kind = 'navigate', contentType } = options
    let currentUrl = url
    let currentMethod = method
    let currentData = data

    for (let hop = 0; hop < maxHops; hop++) {
      const headers: Record<string, string> = {
        'User-Agent': UA,
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Cookie': this.cookieHeader(),
        'Sec-Fetch-Site': 'same-origin',
        'sec-ch-ua': '"Chromium";v="151", "Not.A/Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
      }

      if (kind === 'xhr') {
        headers['Accept'] = '*/*'
        headers['Sec-Fetch-Dest'] = 'empty'
        headers['Sec-Fetch-Mode'] = 'cors'
        headers['Origin'] = BASE
      } else {
        headers['Accept'] =
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
        headers['Sec-Fetch-Dest'] = 'document'
        headers['Sec-Fetch-Mode'] = 'navigate'
        headers['Upgrade-Insecure-Requests'] = '1'
      }

      if (referer) headers['Referer'] = referer

      if (currentData !== undefined) {
        if (contentType) headers['Content-Type'] = contentType
        if (kind !== 'xhr') {
          headers['Origin'] = BASE
          headers['Sec-Fetch-User'] = '?1'
        }
      }

      const res = await fetch(currentUrl, {
        method: currentMethod,
        headers,
        body: currentData !== undefined ? currentData : undefined,
        redirect: 'manual',
      })

      // Collect Set-Cookie
      const setCookies: string[] = []
      res.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') setCookies.push(value)
      })
      // Next.js / undici may fold multiple set-cookie into one header with \n
      const allCookies = setCookies.flatMap(s => s.split('\n'))
      this.absorb(allCookies)

      const body = await res.text()
      const status = res.status
      const location = res.headers.get('location')

      if (follow && status >= 300 && status < 400 && location) {
        const next = location.startsWith('/') ? BASE + location : location
        currentUrl = next
        currentMethod = 'GET'
        currentData = undefined
        continue
      }

      return { status, url: currentUrl, body }
    }
    throw new Error(`too many redirects for ${url}`)
  }

  async get(url: string, options?: Parameters<Session['request']>[2]): Promise<RequestResult> {
    return this.request('GET', url, options)
  }

  async post(
    url: string,
    fields: [string, string][],
    options?: Omit<Parameters<Session['request']>[2], 'data' | 'contentType'>,
  ): Promise<RequestResult> {
    return this.request('POST', url, {
      ...options,
      data: formEncode(fields),
      contentType: 'application/x-www-form-urlencoded',
    })
  }

  async dwr(
    script: string,
    method: string,
    params: JsValue[],
    page: string,
    batchId: number,
    scriptSessionId: string,
  ): Promise<JsValue> {
    const lines = [
      'callCount=1',
      'windowName=',
      `c0-scriptName=${script}`,
      `c0-methodName=${method}`,
      'c0-id=0',
      ...serialize(params),
      `batchId=${batchId}`,
      'instanceId=0',
      `page=${pct(page)}`,
      `scriptSessionId=${scriptSessionId}`,
      '',
    ]
    const url = `${BASE}/vol/dwr/call/plaincall/${script}.${method}.dwr`
    const { status, body } = await this.request('POST', url, {
      data: lines.join('\n'),
      referer: BASE + page,
      follow: false,
      kind: 'xhr',
      contentType: 'text/plain',
    })
    if (status !== 200) {
      throw new DwrError(`${method} returned HTTP ${status}: ${body.slice(0, 300)}`)
    }
    return parseCallback(body)
  }
}

// ---------------------------------------------------------------------------
// scriptSessionId
// ---------------------------------------------------------------------------

function randomStr(len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export function newScriptSessionId(session?: Session): string {
  const prefix = session?.cookies['DWRSESSIONID'] ?? randomStr(27)
  return `${prefix}/${randomStr(6)}-${randomStr(9)}`
}

export function dwrPage(url: string): string {
  return url.includes('/vol') ? '/vol' + url.split('/vol').slice(1).join('/vol') : url
}

// ---------------------------------------------------------------------------
// Session check
// ---------------------------------------------------------------------------

export async function checkSession(session: Session): Promise<void> {
  const { url: final, body } = await session.get(`${BASE}/vol/myPassesCard.do`)
  if (final.includes('home.do') || !final.includes('myPassesCard')) {
    throw new BookingError(
      'session expired — venta.renfe.com redirected to ' +
        final.split('/').pop() +
        '. Re-copy the Cookie header from a logged-in browser tab.',
    )
  }
  const err = pageError(body)
  if (err) throw new BookingError(`myPassesCard.do reported: ${err}`)
}

// ---------------------------------------------------------------------------
// Pass list
// ---------------------------------------------------------------------------

export interface PassEntry {
  code: string
  title: string
  type: string
  localiza: string
  start: string
  end: string
  active: boolean
}

export async function fetchPasses(session: Session): Promise<PassEntry[]> {
  const page = '/vol/myPassesCard.do'
  const data = await session.dwr(
    'myPassesCardManager',
    'getMyPassesCards',
    [[], 'V'],
    page,
    2,
    newScriptSessionId(session),
  )
  if (!Array.isArray(data)) return []

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return (data as any[])
    .filter(p => p && typeof p === 'object')
    .map(p => {
      const code    = String(p.passesCardCode ?? '').trim()
      const title   = String(p.passesCardTitle ?? p.descLongUpper ?? '').trim()
      const type    = String(p.passesCardType ?? '').trim()
      const localiza = String(p.locCode ?? '').trim()
      const start   = String(p.initValDate ?? '').trim()
      const end     = String(p.endValDate ?? '').trim()
      let active = false
      try {
        const [ed, em, ey] = end.split('/')
        const endD   = new Date(+ey, +em - 1, +ed)
        active = today <= endD
      } catch {}
      return { code, title, type, localiza, start, end, active }
    })
}

// ---------------------------------------------------------------------------
// HTML scraping helpers
// ---------------------------------------------------------------------------

function scrapeInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  const inputRe = /<input\b[^>]*>/gi
  for (const tag of html.matchAll(inputRe)) {
    const t = tag[0]
    const name = t.match(/\bname\s*=\s*"([^"]*)"/i)?.[1]
    if (!name) continue
    const type = (t.match(/\btype\s*=\s*"([^"]*)"/i)?.[1] ?? 'text').toLowerCase()
    if ((type === 'radio' || type === 'checkbox') && !/\bchecked\b/i.test(t)) continue
    if (type === 'submit') continue
    out[name] = t.match(/\bvalue\s*=\s*"([^"]*)"/i)?.[1] ?? ''
  }
  return out
}

function extractSlot(url: string): string {
  const m = url.match(/[?&]c=([^&]*)/)
  return m ? decodeURIComponent(m[1]) : ''
}

// ---------------------------------------------------------------------------
// Pass → journey → train list
// ---------------------------------------------------------------------------

export interface PassConfig {
  /** Raw pass object fields returned by getMyPassesCards */
  code: string
  localiza: string
  type: string
  title: string
}

/**
 * Open a purchase slot for `day` using `pass`, then submit the journey form.
 * Returns the trainFormalization URL.
 */
async function stepOpenPass(
  session: Session,
  pass: PassConfig,
  day: Date,
): Promise<{ compra: string; journeyUrl: string }> {
  const url = `${BASE}/vol/myPassesCard.do`
  const { url: final, body: html } = await session.get(url)
  if (final.includes('home.do')) {
    throw new BookingError('session expired — redirected to home.do')
  }
  const scraped = scrapeInputs(html)
  const dd = String(day.getDate()).padStart(2, '0')
  const mm = String(day.getMonth() + 1).padStart(2, '0')
  const yyyy = day.getFullYear()

  const fields: [string, string][] = [
    ['compraActual', scraped['compraActual'] ?? ''],
    ['compraAntigua', ''],
    ['operacion', 'NEW'],
    ['abono', pass.code],
    ['localiza', pass.localiza],
    ['descShort', ''],
    ['tipoAbono', pass.type],
    ['cdgoOperadorAbono', ''],
    ['cdgoTarifaAbono', ''],
    ['descLong', pass.title],
    ['recaptchaResponsesForm', ''],
    ['urlFrom', '/vol/myPassesCard.do'],
  ]
  const { status, url: final2, body } = await session.post(url, fields, { referer: url })
  if (!final2.includes('journeyFormalization')) {
    const err = pageError(body) ?? `HTTP ${status}, landed on ${final2}`
    throw new BookingError(`opening pass failed: ${err}`)
  }
  const compra = extractSlot(final2) || scrapeInputs(body)['compraActual'] || ''
  return { compra, journeyUrl: final2 }
}

async function stepJourney(
  session: Session,
  compra: string,
  day: Date,
  referer: string,
  origin: { name: string; code: string },
  destination: { name: string; code: string },
): Promise<string> {
  const dd = String(day.getDate()).padStart(2, '0')
  const mm = String(day.getMonth() + 1).padStart(2, '0')
  const yyyy = day.getFullYear()
  const fields: [string, string][] = [
    ['compraActual', compra],
    ['compraAntigua', compra],
    ['datesFormalization', `${dd}/${mm}/${yyyy}`],
    ['holderes[0].selected', 'true'],
    ['viajero-bono-ave-flexible', ''],
    ['documento-bono-ave-flexible', ''],
    ['email-bono-ave-flexible', ''],
    ['featuresDataPassesCard.originStation.descEstacion', origin.name],
    ['featuresDataPassesCard.originStation.cdgoEstacion', origin.code],
    ['featuresDataPassesCard.destinStation.descEstacion', destination.name],
    ['featuresDataPassesCard.destinStation.cdgoEstacion', destination.code],
    ['multiformalization', 'false'],
  ]
  const { status, url: final, body } = await session.post(
    `${BASE}/vol/journeyFormalization.do`, fields, { referer })
  if (!final.includes('trainFormalization')) {
    const err = pageError(body) ?? `HTTP ${status}, landed on ${final}`
    throw new BookingError(`journey step failed: ${err}`)
  }
  return final
}

export interface TrainOption {
  cdgoTren: string
  departure: string   // "07.27"
  arrival: string     // "08.28"
  duration: string    // e.g. "1h 01m"
  bookable: boolean
  seatsLeft: number
  class: string
}

export interface DateTrains {
  date: string        // yyyy-mm-dd
  trains: TrainOption[]
  error?: string
}

/**
 * Fetch available trains for a single date.
 * Runs the full open-pass → journey → DWR getTrainsList flow.
 */
export async function fetchTrainsForDate(
  session: Session,
  pass: PassConfig,
  date: Date,
  origin: { name: string; code: string },
  destination: { name: string; code: string },
): Promise<DateTrains> {
  const ymd = toYMD(date)
  try {
    const { compra, journeyUrl } = await stepOpenPass(session, pass, date)
    const trainUrl = await stepJourney(session, compra, date, journeyUrl, origin, destination)

    const page = dwrPage(trainUrl)
    const ssid = newScriptSessionId(session)
    const dd = String(date.getDate()).padStart(2, '0')
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const yyyy = date.getFullYear()

    const raw = await session.dwr(
      'trainFormalizationManager',
      'getTrainsListPassesCard',
      [`${dd}/${mm}/${yyyy}`, [compra, compra]],
      page,
      2,
      ssid,
    )

    if (!Array.isArray(raw)) throw new BookingError('train list came back empty')

    const trains: TrainOption[] = (raw as any[]).map(t => {
      const salida  = t.salida  ?? {}
      const llegada = t.llegada ?? {}
      const clases: any[] = t.clases ?? []
      const bestClass = clases.find((c: any) => (c.numPlazas ?? 0) > 0) ?? clases[0]
      const bookable = !!t.isOperativo && clases.some((c: any) => (c.numPlazas ?? 0) > 0)
      const seatsLeft = clases.reduce((s: number, c: any) => s + (c.numPlazas ?? 0), 0)

      // Duration from salida/llegada epoch values
      let duration = ''
      if (salida.fecha instanceof Object && 'millis' in salida.fecha &&
          llegada.fecha instanceof Object && 'millis' in llegada.fecha) {
        const mins = Math.round((llegada.fecha.millis - salida.fecha.millis) / 60000)
        duration = `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
      }

      return {
        cdgoTren: String(t.cdgoTren ?? ''),
        departure: String(salida.horario ?? ''),
        arrival:   String(llegada.horario ?? ''),
        duration,
        bookable,
        seatsLeft,
        class: String(bestClass?.cdgoClase ?? 'T'),
      }
    })

    return { date: ymd, trains }
  } catch (e) {
    return { date: ymd, trains: [], error: e instanceof Error ? e.message : String(e) }
  }
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Steps 3-5: select train → details → seat page
// ---------------------------------------------------------------------------

/** Select the chosen train via DWR + trainFormalization.do POST */
async function stepSelectTrain(
  session: Session,
  compra: string,
  day: Date,
  trainRaw: any,
  allTrains: any[],
  referer: string,
): Promise<{ detailsUrl: string; detailsHtml: string }> {
  const { augmentTrain } = await import('./dwr')
  const page = dwrPage(referer)
  const ssid = newScriptSessionId(session)

  const seatClass = (trainRaw.clases ?? []).find((c: any) => (c.numPlazas ?? 0) > 0)
    ?? (trainRaw.clases ?? [])[0]

  await session.dwr(
    'trainFormalizationManager',
    'updateBuyFormalizationAjax',
    [augmentTrain(trainRaw, seatClass ?? {}), [compra, compra]],
    page, 4, ssid,
  )

  const dd = String(day.getDate()).padStart(2, '0')
  const mm = String(day.getMonth() + 1).padStart(2, '0')
  const yyyy = day.getFullYear()
  const selectable = allTrains.filter((t: any) => (t.clases ?? []).length > 0)

  const fields: [string, string][] = [
    ['compraActual', compra],
    ['compraAntigua', compra],
    ['forcedSilence', 'false'],
    ['fecha-bono-tarjeta-plus', `${dd}/${mm}/${yyyy}`],
    ...selectable.map((t: any): [string, string] => [
      'bono-colaborativo-clase',
      (t.clases[0]?.cdgoClase ?? 'T'),
    ]),
  ]

  const { status, url: final, body } = await session.post(
    `${BASE}/vol/trainFormalization.do`, fields, { referer })
  if (!final.includes('detailsFormalization')) {
    const err = pageError(body) ?? `HTTP ${status}, landed on ${final}`
    throw new BookingError(`train selection failed: ${err}`)
  }
  return { detailsUrl: final, detailsHtml: body }
}

/** Submit traveller details (seatPreference=SG) to reach the seat-map page */
async function stepDetails(
  session: Session,
  compra: string,
  detailsUrl: string,
  detailsHtml: string,
): Promise<{ seatUrl: string; seatHtml: string }> {
  const scraped = scrapeInputs(detailsHtml)
  scraped['compraActual'] = scraped['compraActual'] || compra
  scraped['compraAntigua'] = scraped['compraAntigua'] || compra

  // Fetch registered payment card via DWR (free reservation, but form requires it)
  let paySelection = ''
  try {
    const ssid = newScriptSessionId(session)
    const page = dwrPage(detailsUrl)
    const data = await session.dwr('payPassesCardManager', 'getRegisteredCards', [], page, 2, ssid)
    const cards = (data as any)?.creditCards ?? []
    if (cards.length) {
      const card = cards.find((c: any) => c.isPredeterminada) ?? cards[0]
      paySelection = JSON.stringify({
        numeroTarjeta: card.numeroTarjeta ?? '',
        numeroTarjetaEncriptado: card.numeroTarjetaEncriptado ?? '',
        isPredeterminada: card.isPredeterminada ? 'true' : 'false',
        alias: card.alias ?? '',
      }, null, 0).replace(/:/g, ': ')
    }
  } catch {}

  const fields: [string, string][] = [
    ['compraActual', compra],
    ['compraAntigua', compra],
    ['withSilence', 'false'],
    ['forcedSilence', 'false'],
    ['claveSms', ''],
    ['pinCode', ''],
    ['docCode', ''],
    ['_ticketAssociate', 'on'],
    ['holderes[1].selected', 'false'],
    ['holderes[1].nombre', ''],
    ['holderes[1].apellido1', ''],
    ['holderes[1].tipoDocumento', '0021'],
    ['holderes[1].documento', ''],
    ['typePMR', ''],
    ['seatPreference', 'SG'],
    ['cdgoFormaPago', '02'],
    ...(paySelection ? [
      ['metodoPagoRedSys', 'on'] as [string, string],
      ['seleccion_tarjetaRedSys', paySelection] as [string, string],
      ['tarjetaRedSys_isPredeterminada', 'on'] as [string, string],
    ] : []),
    ['payData.tarjetaRedSys.numeroTarjeta', ''],
    ['payData.tarjetaRedSys.numeroTarjetaEncriptado', ''],
    ['payData.tarjetaRedSys.alias', ''],
    ['payData.tarjetaRedSys.isPredeterminada', 'false'],
    ['payData.pagoTarjetaNoRegistrada', 'false'],
    ['email', scraped['email'] ?? ''],
    ['phone', scraped['phone'] ?? ''],
    ['prefix', '+34'],
    ['payData.cdgoFormaPago', '02'],
    ['payData.subCdgoFormaPago', ''],
  ]

  const { status, url: final, body } = await session.post(
    `${BASE}/vol/detailsFormalization.do`, fields, { referer: detailsUrl })
  if (!final.includes('selectSeatFormalization')) {
    const err = pageError(body) ?? `HTTP ${status}, landed on ${final}`
    throw new BookingError(`details step failed: ${err}`)
  }
  return { seatUrl: final, seatHtml: body }
}

// ---------------------------------------------------------------------------
// Seat-map parsing
// ---------------------------------------------------------------------------

export type SeatType = 'Pasillo' | 'Ventanilla' | 'Centro' | 'Pasillo, con Mesa' | 'unknown'
export type SeatDirection = 'forward' | 'backward' | 'unknown'
export type SeatStatus = 'free' | 'occupied' | 'unavailable'

export interface Seat {
  id: string          // e.g. "07B"
  row: number         // numeric part
  letter: string      // alpha part
  type: SeatType
  direction: SeatDirection
  status: SeatStatus
}

export interface Coach {
  number: string      // e.g. "1"
  code: string        // cdgoCoche, e.g. "01011"
  seats: Seat[]
}

export interface SeatMap {
  date: string
  cdgoTren: string
  departure: string
  coaches: Coach[]
  compra: string      // needed for the commit step
  seatPageFields: Record<string, string>  // hidden form fields
  seatUrl?: string
  error?: string
}

function parseLabel(label: string): { type: SeatType; direction: SeatDirection } {
  const parts = label.split('-').map(s => s.trim())
  const typePart = parts[0] ?? ''
  const dirPart  = parts[1] ?? ''

  let type: SeatType = 'unknown'
  if (typePart === 'Pasillo, con Mesa') type = 'Pasillo, con Mesa'
  else if (typePart === 'Pasillo')     type = 'Pasillo'
  else if (typePart === 'Ventanilla')  type = 'Ventanilla'
  else if (typePart === 'Centro')      type = 'Centro'

  let direction: SeatDirection = 'unknown'
  if (dirPart.toLowerCase().includes('inverso'))       direction = 'backward'
  else if (dirPart.toLowerCase().includes('marcha'))   direction = 'forward'

  return { type, direction }
}

function parseSeatId(id: string): { row: number; letter: string } {
  const m = id.match(/^(\d+)([A-Z]+)$/i)
  return m ? { row: parseInt(m[1], 10), letter: m[2].toUpperCase() } : { row: 0, letter: id }
}

function extractMvto(html: string): string {
  const candidates: Record<string, number> = {}
  for (const m of html.matchAll(/\/img\/rcd\/coches\/([A-Za-z0-9]+)/g)) {
    const code = m[1].replace(/v\d+$/, '')
    if (code) candidates[code] = (candidates[code] ?? 0) + 1
  }
  return Object.entries(candidates).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

async function fetchCoachAvailability(
  session: Session,
  fields: Record<string, string>,
  coachNumber: string,
  coachCode: string,
  referer: string,
  mvto: string,
): Promise<string[]> {
  const FORM_CHARSET = 'ISO-8859-1'
  const params: Record<string, string> = {
    act: 'vercoche',
    fechatren:    fields['fechatren']    ?? '',
    une:          fields['une']          ?? '',
    estacorigen:  fields['estacorigen']  ?? '',
    estacdestino: fields['estacdestino'] ?? '',
    codigoCoche:  coachCode,
    partes: '1',
    codigoCoche2: '',
    pmr: 'NO',
    mesas: 'NO',
    cabina: 'NO',
    numtren:      fields['numtren']      ?? '',
    maleta: 'N',
    mvto,
    crev: 'N',
    sinv: 'N',
    grupo:        fields['grupo']        ?? '1',
    bicicletas: '',
    categoriaespecial: '',
    numplazasespecial: '0',
    traycombi: '0',
    trentc:      fields['trentc']       ?? '',
    origentc:    fields['origentc']     ?? '',
    destinotc:   fields['destinotc']    ?? '',
    rsvLargoPlazo: fields['rsvLargoPlazo'] ?? 'N',
    tipoContingente: '',
    coche: coachNumber,
    clase: fields['clase'] ?? 'T',
    nummaxplazas: fields['maxPlazas'] ?? '1',
  }
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const url = `${BASE}/vol/ServletRCD?${qs}`
  const { status, body } = await session.request('POST', url, {
    data: '', referer, follow: false, kind: 'xhr',
  })
  if (status !== 200) return []
  return [...body.matchAll(/<plaza>([^<]+)<\/plaza>/g)].map(m => m[1])
}

/** Parse all seat inputs for a given coach from the seat-map HTML */
function parseSeatInputs(html: string, coachNumber: string): Map<string, { label: string; disabled: boolean }> {
  const out = new Map<string, { label: string; disabled: boolean }>()
  const re = new RegExp(
    `<input[^>]*id="plaza_0_${coachNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_([^"]+)"[^>]*>`,
    'gi',
  )
  for (const m of html.matchAll(re)) {
    const tag = m[0]
    const seatId = m[1]
    const label = tag.match(/mensajeAccesibilidad\s*=\s*"([^"]*)"/i)?.[1] ?? ''
    const disabled = /\bdisabled\b/i.test(tag)
    out.set(seatId, { label, disabled })
  }
  return out
}

export async function fetchSeatMap(
  session: Session,
  pass: PassConfig,
  date: Date,
  departure: string,   // "07.27" — the train the user picked
  origin: { name: string; code: string },
  destination: { name: string; code: string },
): Promise<SeatMap> {
  const ymd = toYMD(date)
  try {
    const { compra, journeyUrl } = await stepOpenPass(session, pass, date)
    const trainUrl = await stepJourney(session, compra, date, journeyUrl, origin, destination)

    const page = dwrPage(trainUrl)
    const ssid = newScriptSessionId(session)
    const dd = String(date.getDate()).padStart(2, '0')
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const yyyy = date.getFullYear()

    const rawTrains = await session.dwr(
      'trainFormalizationManager',
      'getTrainsListPassesCard',
      [`${dd}/${mm}/${yyyy}`, [compra, compra]],
      page, 2, ssid,
    ) as any[]

    if (!Array.isArray(rawTrains) || !rawTrains.length) {
      throw new BookingError('train list empty')
    }

    // Find the train matching the chosen departure
    const depKey = departure.replace(':', '.')
    const trainRaw = rawTrains.find(
      (t: any) => String(t.salida?.horario ?? '') === depKey,
    )
    if (!trainRaw) throw new BookingError(`train ${departure} not found in list`)

    const { detailsUrl, detailsHtml } = await stepSelectTrain(
      session, compra, date, trainRaw, rawTrains, trainUrl)
    const { seatUrl, seatHtml } = await stepDetails(
      session, compra, detailsUrl, detailsHtml)

    // Parse form fields we'll need for the commit step
    const seatPageFields = scrapeInputs(seatHtml)
    const mvto = extractMvto(seatHtml)
    if (mvto) seatPageFields['mvto'] = mvto

    // Parse coaches from radio-vagon inputs
    const coachEntries: Array<{ number: string; code: string }> = []
    for (const m of seatHtml.matchAll(/<input[^>]*class="radio-vagon"[^>]*>/gi)) {
      const tag = m[0]
      const number = tag.match(/\bvalue\s*=\s*"([^"]*)"/i)?.[1] ?? ''
      const code   = tag.match(/\bcdgoCoche\s*=\s*"([^"]*)"/i)?.[1] ?? ''
      if (number && code) coachEntries.push({ number, code })
    }

    // For each coach fetch availability + parse seat map
    const coaches = await Promise.all(coachEntries.map(async ({ number, code }): Promise<Coach> => {
      const available = new Set(
        await fetchCoachAvailability(session, seatPageFields, number, code, seatUrl, mvto))
      const seatData = parseSeatInputs(seatHtml, number)

      const seats: Seat[] = []
      // All seats declared in HTML (both free and occupied)
      for (const [seatId, { label, disabled }] of seatData.entries()) {
        const { type, direction } = parseLabel(label)
        const { row, letter } = parseSeatId(seatId)
        if (letter === 'H') continue
        let status: SeatStatus = 'occupied'
        if (disabled) status = 'unavailable'
        else if (available.has(seatId)) status = 'free'
        seats.push({ id: seatId, row, letter, type, direction, status })
      }

      // Sort by row then letter for consistent rendering
      seats.sort((a, b) => a.row - b.row || a.letter.localeCompare(b.letter))
      return { number, code, seats }
    }))

    return {
      date: ymd,
      cdgoTren: String(trainRaw.cdgoTren ?? ''),
      departure: depKey,
      coaches,
      compra,
      seatPageFields,
      seatUrl,
    }
  } catch (e) {
    return {
      date: ymd, cdgoTren: '', departure, coaches: [], compra: '', seatPageFields: {},
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export interface BookingResult {
  date: string
  committed: boolean
  train: string
  departure: string
  coach: string
  seat: string
  locator?: string
  confirmationUrl?: string
  error?: string
}

const SEAT_FIELDS: Array<[string, 'scrape' | string]> = [
  ['clase', 'scrape'],
  ['maxPlazas', 'scrape'],
  ['fechatren', 'scrape'],
  ['une', 'scrape'],
  ['numtren', 'scrape'],
  ['grupo', 'scrape'],
  ['estacorigen', 'scrape'],
  ['estacdestino', 'scrape'],
  ['mesa', 'NO'],
  ['bicicletas', ''],
  ['categoriaespecial', ''],
  ['numplazasespecial', '0'],
  ['trentc', 'scrape'],
  ['origentc', 'scrape'],
  ['destinotc', 'scrape'],
  ['rsvLargoPlazo', 'scrape'],
  ['tipoContingente', ''],
  ['caracteristicas', 'NO'],
  ['multiSelPmr', 'false'],
  ['tokenSelectSeat', 'scrape'],
]

function extractLocator(html: string): string | undefined {
  const patterns = [
    /[Ll]ocalizador[^A-Z0-9]{0,40}([A-Z0-9]{6,10})/,
    /id="localizador"[^>]*>\s*([A-Z0-9]{6,10})/,
  ]
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1]
    if (value) return value
  }
}

/** Replay the selected journey and create one real reservation. */
export async function commitSelectedSeat(
  session: Session,
  pass: PassConfig,
  date: Date,
  departure: string,
  origin: { name: string; code: string },
  destination: { name: string; code: string },
  selection: { coach: string; seat: string },
): Promise<BookingResult> {
  const ymd = toYMD(date)
  const base: BookingResult = {
    date: ymd, committed: false, train: '', departure,
    coach: selection.coach, seat: selection.seat,
  }
  try {
    if (/H$/i.test(selection.seat)) throw new BookingError('H seats cannot be reserved')
    const map = await fetchSeatMap(session, pass, date, departure, origin, destination)
    if (map.error) throw new BookingError(map.error)
    // compra can legitimately be empty: on some Renfe flows the purchase slot
    // exists only in the server-side session and is not echoed in ?c= or HTML.
    if (!map.seatUrl) throw new BookingError('Renfe did not return the seat reservation page URL')

    const coach = map.coaches.find(item => item.number === selection.coach)
    if (!coach) throw new BookingError(`coach ${selection.coach} is no longer available`)
    const seat = coach.seats.find(item => item.id === selection.seat)
    if (!seat || seat.status !== 'free') {
      throw new BookingError(`seat ${selection.seat} is no longer available`)
    }

    const scraped = map.seatPageFields
    const fields: [string, string][] = [
      ['compraActual', map.compra],
      ['compraAntigua', map.compra],
      ['numeroVagon_0', coach.number],
    ]
    const plazasres = `${seat.id}-${coach.code}-${scraped.clase ?? 'T'}-P-1; `
    for (const [name, source] of SEAT_FIELDS) {
      fields.push([name, source === 'scrape' ? (scraped[name] ?? '') : source])
      if (name === 'maxPlazas') fields.push(['plazasres', plazasres])
    }

    const { status, url, body } = await session.post(
      `${BASE}/vol/selectSeatFormalization.do`, fields, { referer: map.seatUrl })
    if (!url.includes('buyFormalization')) {
      throw new BookingError(`seat commit failed: ${pageError(body) ?? `HTTP ${status}, landed on ${url}`}`)
    }
    return {
      ...base,
      committed: true,
      train: map.cdgoTren,
      departure: map.departure,
      locator: extractLocator(body),
      confirmationUrl: url,
    }
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  }
}

export function pageError(html: string): string | null {
  const patterns = [
    /errorDefecto\s*=\s*'([^']{4,300})'/,
    /errorDefecto\s*=\s*"([^"]{4,300})"/,
  ]
  for (const p of patterns) {
    const m = html.match(p)
    if (m) return m[1].replace(/\s+/g, ' ').trim()
  }
  if (html.toLowerCase().includes('queue-it') && html.toLowerCase().includes('waitingroom')) {
    return 'queue-it waiting room — Renfe is throttling; retry later'
  }
  return null
}
