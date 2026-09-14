/**
 * Minimal DWR (Direct Web Remoting) codec — port of dwr.py.
 *
 * parse_callback: reads a DWR plaincall reply and returns the payload as
 * plain JS objects.
 *
 * serialize: turns a JS value graph back into the c0-eN parameter lines
 * a DWR endpoint expects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export class JsDate {
  constructor(public millis: number) {}
}

export class DwrError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DwrError'
  }
}

export type JsValue = null | boolean | number | string | JsDate | JsObject | JsArray
export interface JsObject { [key: string]: JsValue }
export type JsArray = JsValue[]

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class JsParser {
  private pos = 0
  constructor(
    private text: string,
    private variables: Record<string, JsValue> = {},
  ) {}

  private skipSpace() {
    while (this.pos < this.text.length && ' \t\r\n'.includes(this.text[this.pos])) {
      this.pos++
    }
  }

  private expect(char: string) {
    this.skipSpace()
    if (this.pos >= this.text.length || this.text[this.pos] !== char) {
      const got = this.text.slice(this.pos, this.pos + 20)
      throw new Error(`expected ${char} at offset ${this.pos}, got ${JSON.stringify(got)}`)
    }
    this.pos++
  }

  private peek(): string {
    this.skipSpace()
    return this.pos < this.text.length ? this.text[this.pos] : ''
  }

  parseValue(): JsValue {
    this.skipSpace()
    if (this.pos >= this.text.length) throw new Error('unexpected end of input')
    const ch = this.text[this.pos]
    if (ch === '{') return this.parseObject()
    if (ch === '[') return this.parseArray()
    if (ch === '"' || ch === "'") return this.parseString()
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber()
    return this.parseWord()
  }

  private parseObject(): JsObject {
    this.expect('{')
    const out: JsObject = {}
    if (this.peek() === '}') { this.expect('}'); return out }
    while (true) {
      this.skipSpace()
      let key: string
      if (this.text[this.pos] === '"' || this.text[this.pos] === "'") {
        key = this.parseString()
      } else {
        const m = this.text.slice(this.pos).match(/^[A-Za-z_$][\w$]*/)
        if (!m) throw new Error(`bad object key at offset ${this.pos}`)
        key = m[0]; this.pos += key.length
      }
      this.expect(':')
      out[key] = this.parseValue()
      if (this.peek() === ',') {
        this.expect(',')
        if (this.peek() === '}') break
        continue
      }
      break
    }
    this.expect('}')
    return out
  }

  private parseArray(): JsArray {
    this.expect('[')
    const out: JsArray = []
    if (this.peek() === ']') { this.expect(']'); return out }
    while (true) {
      out.push(this.parseValue())
      if (this.peek() === ',') {
        this.expect(',')
        if (this.peek() === ']') break
        continue
      }
      break
    }
    this.expect(']')
    return out
  }

  private parseString(): string {
    const q = this.text[this.pos++]
    const chunks: string[] = []
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos]
      if (ch === '\\') {
        const nxt = this.text[this.pos + 1]
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }
        if (nxt === 'u') {
          chunks.push(String.fromCharCode(parseInt(this.text.slice(this.pos + 2, this.pos + 6), 16)))
          this.pos += 6
        } else {
          chunks.push(map[nxt] ?? nxt)
          this.pos += 2
        }
        continue
      }
      if (ch === q) { this.pos++; return chunks.join('') }
      chunks.push(ch); this.pos++
    }
    throw new Error('unterminated string')
  }

  private parseNumber(): number {
    const m = this.text.slice(this.pos).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)
    if (!m) throw new Error(`bad number at offset ${this.pos}`)
    this.pos += m[0].length
    return m[0].includes('.') || m[0].includes('e') || m[0].includes('E')
      ? parseFloat(m[0])
      : parseInt(m[0], 10)
  }

  private parseWord(): JsValue {
    const m = this.text.slice(this.pos).match(/^[A-Za-z_$][\w$.]*/)
    if (!m) throw new Error(`bad token at offset ${this.pos}: ${JSON.stringify(this.text.slice(this.pos, this.pos + 20))}`)
    const word = m[0]; this.pos += word.length
    if (word === 'null' || word === 'undefined') return null
    if (word === 'true') return true
    if (word === 'false') return false
    if (word === 'new') {
      this.skipSpace()
      const ctor = this.text.slice(this.pos).match(/^Date\s*\(/)
      if (!ctor) throw new Error(`unsupported constructor at offset ${this.pos}`)
      this.pos += ctor[0].length
      const millis = this.parseValue()
      this.expect(')')
      return new JsDate(Number(millis) || 0)
    }
    if (word in this.variables) return this.variables[word]
    throw new Error(`unknown identifier ${word}`)
  }
}

// ---------------------------------------------------------------------------
// parse_callback
// ---------------------------------------------------------------------------

const VAR_DECL    = /var\s+(s\d+)\s*=\s*(\{\}|\[\])\s*;/g
const ASSIGN_RE   = /(s\d+)((?:\.[A-Za-z_$][\w$]*|\[\d+\])+)\s*=\s*/g
const CALLBACK_RE = /handleCallback\(\s*(?:"[^"]*"|'[^']*')\s*,\s*(?:"[^"]*"|'[^']*')\s*,\s*/
const EXCEPTION_RE = /handleBatchException\(\s*/

export function parseCallback(body: string): JsValue {
  if (EXCEPTION_RE.test(body)) {
    const m = body.match(/handleBatchException\(\s*/)!
    try {
      const detail = new JsParser(body.slice(m.index! + m[0].length)).parseValue()
      throw new DwrError(`server returned a DWR batch exception: ${JSON.stringify(detail)}`)
    } catch (e) {
      if (e instanceof DwrError) throw e
      throw new DwrError(`server returned a DWR batch exception: ${body.slice(0, 400)}`)
    }
  }

  const variables: Record<string, JsValue> = {}
  for (const [, name, literal] of body.matchAll(VAR_DECL)) {
    variables[name] = literal === '{}' ? {} : []
  }

  for (const match of body.matchAll(ASSIGN_RE)) {
    const target = variables[match[1]]
    if (target == null) continue
    const path = [...match[2].matchAll(/\.([A-Za-z_$][\w$]*)|\[(\d+)\]/g)]
      .map(m => [m[1] ?? '', m[2] ?? ''] as [string, string])
    const parser = new JsParser(body, variables)
    ;(parser as any).pos = match.index! + match[0].length
    const value = parser.parseValue()
    assignPath(target, path, value)
  }

  const call = body.match(CALLBACK_RE)
  if (!call) throw new DwrError(`no handleCallback found in reply: ${JSON.stringify(body.slice(0, 300))}`)
  const parser = new JsParser(body, variables)
  ;(parser as any).pos = call.index! + call[0].length
  return parser.parseValue()
}

function assignPath(target: JsValue, path: [string, string][], value: JsValue): void {
  for (let i = 0; i < path.length; i++) {
    const [name, digits] = path[i]
    const last = i === path.length - 1
    const key: string | number = name || parseInt(digits, 10)
    if (last) {
      if (Array.isArray(target) && typeof key === 'number') {
        while ((target as JsArray).length <= key) (target as JsArray).push(null)
        ;(target as JsArray)[key] = value
      } else {
        (target as JsObject)[key as string] = value
      }
      return
    }
    const [nxtName] = path[i + 1]
    const def: JsValue = nxtName ? {} : []
    if (Array.isArray(target) && typeof key === 'number') {
      while ((target as JsArray).length <= key) (target as JsArray).push(null)
      if ((target as JsArray)[key] == null) (target as JsArray)[key] = def
      target = (target as JsArray)[key]
    } else {
      if (!((key as string) in (target as JsObject))) (target as JsObject)[key as string] = def
      target = (target as JsObject)[key as string]
    }
  }
}

// ---------------------------------------------------------------------------
// augment_train
// ---------------------------------------------------------------------------

function formatDate(value: JsValue): string | null {
  if (!(value instanceof JsDate)) return null
  const d = new Date(value.millis)
  // Format in Europe/Madrid local time
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'Europe/Madrid',
  }).format(d).replace(/\//g, '/')
}

export function augmentTrain(train: JsObject, seatClass: JsObject): JsObject {
  const out = { ...train }
  for (const endpoint of ['salida', 'llegada']) {
    const node = out[endpoint]
    if (node && typeof node === 'object' && !Array.isArray(node) && !(node as JsObject).fechaFormateada) {
      const n = { ...(node as JsObject) }
      n.fechaFormateada = formatDate((node as JsObject).fecha)
      out[endpoint] = n
    }
  }
  out.fechaDesdeCIFormateada = formatDate(train.fechaDesdeCI)
  out.datatarget = `modalTipoTren${train.cdgoTren}`
  out.tipoTrayecto = train.isDirecto ? 'Tren directo' : 'Tren con paradas'
  out.caracteristicas = []
  out.cdgoClase = seatClass.cdgoClase
  return out
}

// ---------------------------------------------------------------------------
// serialize
// ---------------------------------------------------------------------------

function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

function scalar(value: JsValue): string {
  if (value === null) return 'null:null'
  if (typeof value === 'boolean') return `boolean:${value}`
  if (value instanceof JsDate) return `date:${value.millis}`
  if (typeof value === 'number') return `number:${Number.isInteger(value) ? value : value}`
  if (typeof value === 'string') return `string:${pctEncode(value)}`
  throw new Error(`cannot serialise ${typeof value}`)
}

class Serializer {
  lines: string[] = []
  private nextId = 1
  private memo = new Map<object, string>()

  constructor(private prefix: string = 'c0') {}

  add(value: JsValue): string {
    if (value !== null && typeof value === 'object' && !(value instanceof JsDate)) {
      const first = this.memo.get(value)
      if (first !== undefined) {
        const ref = `${this.prefix}-e${this.nextId++}`
        this.lines.push(`${ref}=reference:${first}`)
        return `reference:${ref}`
      }
    }
    const ref = `${this.prefix}-e${this.nextId++}`
    if (value !== null && typeof value === 'object' && !(value instanceof JsDate)) {
      this.memo.set(value, ref)
    }
    if (Array.isArray(value)) {
      const childRefs = value.map(item => this.add(item))
      this.lines.push(`${ref}=array:[${childRefs.join(',')}]`)
    } else if (value !== null && typeof value === 'object' && !(value instanceof JsDate)) {
      const obj = value as JsObject
      const childRefs: string[] = []
      for (const [k, v] of Object.entries(obj)) {
        childRefs.push(`${k}:${this.add(v)}`)
      }
      this.lines.push(`${ref}=Object_Object:{${childRefs.join(', ')}}`)
    } else {
      this.lines.push(`${ref}=${scalar(value)}`)
    }
    return `reference:${ref}`
  }
}

export function serialize(params: JsValue[], prefix = 'c0'): string[] {
  const s = new Serializer(prefix)
  for (let i = 0; i < params.length; i++) {
    const param = params[i]
    if (Array.isArray(param)) {
      const refs = param.map(v => s.add(v))
      s.lines.push(`${prefix}-param${i}=array:[${refs.join(',')}]`)
    } else if (param !== null && typeof param === 'object' && !(param instanceof JsDate)) {
      const obj = param as JsObject
      const refs: string[] = []
      for (const [k, v] of Object.entries(obj)) {
        refs.push(`${k}:${s.add(v)}`)
      }
      s.lines.push(`${prefix}-param${i}=Object_Object:{${refs.join(', ')}}`)
    } else {
      s.lines.push(`${prefix}-param${i}=${scalar(param)}`)
    }
  }
  return s.lines
}
