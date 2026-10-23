/**
 * Argument parsing. Small on purpose: `--name value`, `--name=value`, bare `--flag`, and `--`.
 */
import { readFileSync, existsSync } from 'node:fs'
import { usage } from './exit.ts'

export interface ParsedArgs {
  positionals: string[]
  flags: Map<string, string>
}

/** Flags that never take a value. */
const BOOLEAN_FLAGS = new Set(['dry-run', 'help', 'stdin'])

/**
 * A secret on argv is readable by every user on the machine (ps, shell history, CI logs).
 * These names are refused outright, before anything else runs.
 */
export const SECRET_FLAGS = ['key', 'api-key', 'apikey', 'token', 'secret', 'password'] as const

export function rejectSecretFlags(argv: string[]): void {
  for (const a of argv) {
    if (a === '--') return
    const name = /^--?([A-Za-z-]+)(?:=|$)/.exec(a)?.[1]?.toLowerCase()
    if (name && (SECRET_FLAGS as readonly string[]).includes(name)) {
      throw usage('secret_on_argv', `--${name} is refused: pass the key with --key-file <path> or --key-file - (stdin), or TEAMDA_API_KEY`)
    }
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (!a.startsWith('--') || a === '-') {
      positionals.push(a)
      continue
    }
    const eq = a.indexOf('=')
    if (eq > 2) {
      flags.set(a.slice(2, eq), a.slice(eq + 1))
      continue
    }
    const name = a.slice(2)
    const next = argv[i + 1]
    if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith('--')) {
      flags.set(name, 'true')
      continue
    }
    flags.set(name, next)
    i++
  }
  return { positionals, flags }
}

/** Take and remove a flag, so whatever is left can be checked for unknown names. */
export function takeFlag(flags: Map<string, string>, name: string): string | undefined {
  const v = flags.get(name)
  flags.delete(name)
  return v
}

/** `--json '{...}'` or `--json @file.json`. Always an object or array. */
export function readJsonFlag(raw: string | undefined): unknown {
  if (raw === undefined) return undefined
  let text = raw
  if (raw.startsWith('@')) {
    const file = raw.slice(1)
    if (!existsSync(file)) throw usage('json_file_missing', `not found: ${file}`)
    text = readFileSync(file, 'utf8')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw usage('invalid_json', '--json is not valid JSON')
  }
}

/**
 * Flag values are strings. A value that starts with `{` or `[` is read as JSON so nested input
 * can be given inline. Numbers and booleans stay strings; use --json when a type matters.
 */
export function flagValue(raw: string): unknown {
  const t = raw.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t)
    } catch {
      return raw
    }
  }
  return raw
}
