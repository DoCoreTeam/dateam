/**
 * `teamda help [--json] [words...]`. The listing comes from the same tree that runs commands.
 */
import { VERSION } from '../context.ts'
import type { Command, CommandTree } from '../spec.ts'
import type { InputSpec } from '../inputs.ts'

export const BUILTINS = [
  { cli: 'help', summary: 'list commands (--json for one machine-readable object)' },
  { cli: 'sync', summary: 'download the server spec and cache it when its sha256 changed' },
  { cli: 'api', summary: 'raw call: teamda api <METHOD> <path> [--json body]' },
  { cli: 'auth login', summary: 'store a key from --key-file <path> or --key-file - (stdin)' },
  { cli: 'auth status', summary: 'show where the key comes from and its first 12 characters' },
  { cli: 'auth logout', summary: 'remove the stored key' },
  { cli: 'config set base-url', summary: 'save the server URL (no secrets in the config file)' },
  { cli: 'config get', summary: 'print the config file values' },
] as const

export interface HelpParam {
  name: string
  in: 'path' | 'query'
  type?: string
  required: boolean
  enum?: (string | number)[]
  description?: string
}

export interface HelpBody {
  /** false when the server may read fields the spec could not list; unknown flags then pass */
  closed: boolean
  fields: (InputSpec & { position?: number })[]
}

export interface HelpEntry {
  cli: string
  method: string
  path: string
  scope: string
  summary: string
  /** path values (in order, positional) and query parameters */
  params: HelpParam[]
  /** true when the query list is complete and an unknown flag is refused */
  paramsClosed: boolean
  /** null when the command takes no body */
  body: HelpBody | null
}

export interface HelpJson {
  version: string
  specSource: string
  specHash: string | null
  builtins: { cli: string; summary: string }[]
  /** the words asked for, empty for the full listing */
  filter: string
  commands: HelpEntry[]
}

export function helpJson(tree: CommandTree, specSource: string, specHash: string | null, filter: string[] = []): HelpJson {
  const prefix = filter.join(' ')
  const commands = tree.commands
    .filter((c) => !prefix || c.cli === prefix || c.cli.startsWith(`${prefix} `))
    .map(entryOf)
  return { version: VERSION, specSource, specHash, builtins: BUILTINS.map((b) => ({ ...b })), filter: prefix, commands }
}

function entryOf(c: Command): HelpEntry {
  const params: HelpParam[] = [
    ...c.pathParams.map((name) => ({ name, in: 'path' as const, type: 'string', required: true })),
    ...c.inputs.query.map((q) => ({ ...q, in: 'query' as const })),
  ]
  const sendsBody = c.hasBody && c.method !== 'GET'
  const body: HelpBody | null = sendsBody && c.inputs.body
    ? {
        closed: c.inputs.bodyClosed,
        fields: c.inputs.body.map((f) => {
          const at = c.actionArgs.indexOf(f.name)
          return at >= 0 ? { ...f, position: at + 1 } : f
        }),
      }
    : null
  return {
    cli: c.cli, method: c.method, path: c.path, scope: c.scope, summary: c.summary,
    params, paramsClosed: c.inputs.queryClosed, body,
  }
}

const typeLabel = (i: { type?: string; enum?: (string | number)[]; itemType?: string }): string => {
  if (i.enum) return i.enum.join('|')
  if (i.type === 'array') return i.itemType ? `${i.itemType}[] (a,b or JSON)` : 'list (a,b or JSON)'
  if (i.type === 'object') return 'JSON object'
  return i.type ?? 'any'
}

function inputLine(name: string, i: { type?: string; required: boolean; enum?: (string | number)[]; itemType?: string; description?: string }, extra = ''): string {
  const req = i.required ? 'required' : 'optional'
  return `    --${name.padEnd(24)} ${typeLabel(i).padEnd(18)} ${req}${extra}${i.description ? `  ${i.description}` : ''}`
}

/** One command in full: words, path values, query parameters, body fields */
export function commandText(c: HelpEntry): string {
  const positional = c.params.filter((p) => p.in === 'path').map((p) => `<${p.name}>`).join(' ')
  const lines = [
    `teamda ${c.cli}${positional ? ` ${positional}` : ''} [flags]`,
    '',
    `  ${c.summary}`,
    `  ${c.method} ${c.path}  scope: ${c.scope}`,
  ]
  const path = c.params.filter((p) => p.in === 'path')
  if (path.length) {
    lines.push('', '  path values (positional, in order, or --name):')
    for (const p of path) lines.push(`    <${p.name}>`)
  }
  const query = c.params.filter((p) => p.in === 'query')
  lines.push('', `  query parameters${c.paramsClosed ? '' : ' (the server may read more than listed)'}:`)
  if (query.length === 0) lines.push(c.paramsClosed ? '    none' : '    not listed')
  for (const q of query) lines.push(inputLine(q.name, q))
  if (c.body) {
    lines.push('', `  body fields (flags or --json @file${c.body.closed ? '' : '; the server may read more than listed'}):`)
    if (c.body.fields.length === 0) lines.push('    not listed')
    for (const f of c.body.fields) lines.push(inputLine(f.name, f, f.position ? `, argument ${f.position}` : ''))
  }
  return `${lines.join('\n')}\n`
}

export function helpText(h: HelpJson): string {
  // exactly one command asked for: show it in full instead of the listing
  const exact = h.filter ? h.commands.find((c) => c.cli === h.filter) : undefined
  if (exact) {
    const more = h.commands.filter((c) => c !== exact).map((c) => `  teamda ${c.cli}`)
    return commandText(exact) + (more.length ? `\n  more under "${h.filter}":\n${more.join('\n')}\n` : '')
  }
  const lines: string[] = [
    `teamda ${h.version}  (spec: ${h.specSource}${h.specHash ? ` ${h.specHash}` : ''})`,
    '',
    'usage: teamda <words...> [--param value] [--json body|@file] [--dry-run] [--no-verify] [--idempotency-key k] [--out file]',
    '',
    'built-in:',
    ...h.builtins.map((b) => `  ${b.cli.padEnd(22)} ${b.summary}`),
    '',
    `commands (${h.commands.length}):`,
  ]
  let group = ''
  for (const c of h.commands) {
    const top = c.cli.split(' ')[0]
    if (top !== group) { lines.push('', `[${top}]`); group = top }
    lines.push(`  ${c.cli.padEnd(44)} ${c.method.padEnd(6)} ${c.scope.padEnd(7)} ${c.summary}`)
  }
  lines.push('', 'exit codes: 0 ok, 1 unknown or network, 2 input (400 422), 3 auth (401 403), 4 not found, 5 conflict (409), 6 rate limit (429), 7 approval (202), 8 server (5xx), 9 saved value differs from what was sent (--no-verify skips the check)')
  return `${lines.join('\n')}\n`
}
