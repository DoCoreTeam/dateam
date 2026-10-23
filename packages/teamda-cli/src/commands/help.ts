/**
 * `teamda help [--json] [words...]`. The listing comes from the same tree that runs commands.
 */
import { VERSION } from '../context.ts'
import type { CommandTree } from '../spec.ts'

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

export interface HelpEntry {
  cli: string
  method: string
  path: string
  scope: string
  summary: string
}

export interface HelpJson {
  version: string
  specSource: string
  specHash: string | null
  builtins: { cli: string; summary: string }[]
  commands: HelpEntry[]
}

export function helpJson(tree: CommandTree, specSource: string, specHash: string | null, filter: string[] = []): HelpJson {
  const prefix = filter.join(' ')
  const commands = tree.commands
    .filter((c) => !prefix || c.cli === prefix || c.cli.startsWith(`${prefix} `))
    .map((c) => ({ cli: c.cli, method: c.method, path: c.path, scope: c.scope, summary: c.summary }))
  return { version: VERSION, specSource, specHash, builtins: BUILTINS.map((b) => ({ ...b })), commands }
}

export function helpText(h: HelpJson): string {
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
