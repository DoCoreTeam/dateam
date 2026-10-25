/**
 * What a command accepts, read from the spec, and the checks run before a request leaves.
 *
 * The spec carries each command's query parameters and body fields with a JSON schema type.
 * A list is "closed" when the server reads nothing else: `x-query-complete: true` for the query,
 * `additionalProperties: false` for the body. Only a closed list rejects an unknown name; an open
 * one passes it through, because the server may read names the spec could not list.
 *
 * The same checks run with and without --dry-run, so a dry run that passes does not fail
 * later on an input error the CLI could have seen.
 */
import { usage } from './exit.ts'

export interface InputSpec {
  name: string
  type?: string
  required: boolean
  enum?: (string | number)[]
  /** array element type, when the schema names one */
  itemType?: string
  description?: string
}

export interface CommandInputs {
  query: InputSpec[]
  queryClosed: boolean
  /** null when the command takes no body */
  body: InputSpec[] | null
  bodyClosed: boolean
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function inputOf(name: string, schema: unknown, required: boolean, description?: unknown): InputSpec {
  const s = isObj(schema) ? schema : {}
  const type = typeof s.type === 'string' ? s.type : undefined
  const items = isObj(s.items) && typeof s.items.type === 'string' ? s.items.type : undefined
  const desc = typeof description === 'string' ? description : typeof s.description === 'string' ? s.description : undefined
  return {
    name,
    ...(type ? { type } : {}),
    required,
    ...(Array.isArray(s.enum) ? { enum: s.enum as (string | number)[] } : {}),
    ...(items ? { itemType: items } : {}),
    ...(desc ? { description: desc } : {}),
  }
}

interface OpLike {
  parameters?: { name: string; in: string; required?: boolean; schema?: unknown; description?: string }[]
  requestBody?: { content?: Record<string, { schema?: unknown }> }
  'x-query-complete'?: boolean
}

/** Control names the CLI owns; never listed as inputs */
const RESERVED = new Set(['dryRun', 'args'])

export function inputsOf(op: OpLike, hasBody: boolean): CommandInputs {
  const query = (op.parameters ?? [])
    .filter((p) => p.in === 'query' && !RESERVED.has(p.name))
    .map((p) => inputOf(p.name, p.schema, !!p.required, p.description))
  const schema = op.requestBody?.content?.['application/json']?.schema
  let body: InputSpec[] | null = null
  let bodyClosed = false
  if (hasBody) {
    const s = isObj(schema) ? schema : {}
    const closed = isObj(s.properties)
    const props = closed ? s.properties as Json : isObj(s['x-known-properties']) ? s['x-known-properties'] as Json : {}
    const req = new Set<string>([
      ...(Array.isArray(s.required) ? s.required as string[] : []),
      ...(Array.isArray(s['x-required']) ? s['x-required'] as string[] : []),
    ])
    body = Object.entries(props).filter(([k]) => !RESERVED.has(k)).map(([k, v]) => inputOf(k, v, req.has(k)))
    // properties without additionalProperties:false is the server action shape (names plus args): closed too
    bodyClosed = closed && s.additionalProperties !== true
  }
  return { query, queryClosed: op['x-query-complete'] === true, body, bodyClosed }
}

/** Edit distance, for "did you mean" lists */
function distance(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  const row = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= y.length; j++) {
      const cur = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[y.length]
}

const MAX_SUGGESTIONS = 5

/** Known names ordered by closeness to the given one; contained names first */
export function suggest(name: string, known: string[]): string[] {
  const n = name.toLowerCase()
  return [...known]
    .map((k) => ({ k, d: k.toLowerCase().includes(n) || n.includes(k.toLowerCase()) ? 0 : distance(n, k) }))
    .sort((a, b) => a.d - b.d || a.k.localeCompare(b.k))
    .slice(0, MAX_SUGGESTIONS)
    .map((x) => x.k)
}

const INTEGER = /^[+-]?\d+$/
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/
const TRUE = new Set(['true', '1', 'yes'])
const FALSE = new Set(['false', '0', 'no'])

function bad(cli: string, input: InputSpec, raw: string, expected: string): never {
  throw usage('invalid_flag_value', `${cli}: --${input.name} must be ${expected}, got "${raw}"`, { candidates: input.enum?.map(String) })
}

function checkEnum(cli: string, input: InputSpec, raw: string, value: string | number): void {
  if (input.enum && !input.enum.some((e) => String(e) === String(value))) {
    bad(cli, input, raw, `one of ${input.enum.join(', ')}`)
  }
}

/**
 * A flag string to the value its schema type asks for. Throws a usage error naming the flag
 * when the string cannot be that type. Untyped inputs keep the old rule: `{` or `[` is JSON.
 */
export function coerce(cli: string, input: InputSpec | undefined, raw: string, jsonish: (s: string) => unknown): unknown {
  if (!input?.type) return jsonish(raw)
  const t = raw.trim()
  switch (input.type) {
    case 'integer':
      if (!INTEGER.test(t)) bad(cli, input, raw, 'an integer')
      checkEnum(cli, input, raw, Number(t))
      return Number(t)
    case 'number':
      if (!NUMBER.test(t)) bad(cli, input, raw, 'a number')
      checkEnum(cli, input, raw, Number(t))
      return Number(t)
    case 'boolean':
      if (TRUE.has(t.toLowerCase())) return true
      if (FALSE.has(t.toLowerCase())) return false
      return bad(cli, input, raw, 'true or false')
    case 'array': {
      if (t.startsWith('[')) {
        const v = jsonish(t)
        if (!Array.isArray(v)) bad(cli, input, raw, 'a JSON array')
        return v
      }
      const parts = t === '' ? [] : t.split(',').map((s) => s.trim())
      const itemInput: InputSpec = { name: input.name, required: false, ...(input.itemType ? { type: input.itemType } : {}) }
      return input.itemType && input.itemType !== 'string' ? parts.map((p) => coerce(cli, itemInput, p, jsonish)) : parts
    }
    case 'object': {
      const v = jsonish(t)
      if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(cli, input, raw, 'a JSON object')
      return v
    }
    default:
      checkEnum(cli, input, raw, raw)
      return raw
  }
}

/** Query values stay strings on the wire; this only checks they parse as their type */
export function checkQueryValue(cli: string, input: InputSpec | undefined, raw: string): void {
  if (!input?.type || input.type === 'string' || input.type === 'array') {
    if (input?.enum) checkEnum(cli, input, raw, raw)
    return
  }
  coerce(cli, input, raw, (s) => s)
}

/** A name is "close" when one contains the other or it is a couple of edits away */
const isClose = (a: string, b: string): boolean => {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x.includes(y) || y.includes(x) || distance(x, y) <= Math.max(2, Math.floor(Math.min(x.length, y.length) / 3))
}

export function unknownFlag(cli: string, name: string, known: string[]): never {
  const candidates = suggest(name, known)
  const close = candidates.filter((c) => isClose(name, c))
  const hint = close.length ? `; did you mean --${close[0]}?` : known.length ? `; accepted: ${known.map((k) => `--${k}`).join(' ')}` : '; this command takes no flags'
  throw usage('unknown_flag', `${cli}: unknown flag --${name}${hint}`, { candidates })
}

export function missingInputs(cli: string, names: string[]): never {
  throw usage('missing_param', `${cli}: missing required ${names.map((n) => `--${n}`).join(', ')}`, { candidates: names })
}
