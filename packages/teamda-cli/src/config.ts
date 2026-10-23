/**
 * Config directory and the non-secret config file.
 *
 * The config file holds the base URL only. Keys never go here; they live in the OS credential
 * store (see credentials.ts) or in TEAMDA_API_KEY for CI.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Context } from './context.ts'
import { usage } from './exit.ts'

export interface Config {
  baseUrl?: string
}

export const CONFIG_KEYS = ['base-url'] as const

export function configDir(ctx: Context): string {
  const { env } = ctx
  if (env.TEAMDA_CONFIG_DIR) return env.TEAMDA_CONFIG_DIR
  if (ctx.platform === 'win32') {
    const appData = env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    return join(appData, 'teamda')
  }
  const xdg = env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(xdg, 'teamda')
}

export function ensureConfigDir(ctx: Context): string {
  const dir = configDir(ctx)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

const configFile = (ctx: Context) => join(configDir(ctx), 'config.json')

export function readConfig(ctx: Context): Config {
  const file = configFile(ctx)
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Config
    return typeof parsed === 'object' && parsed !== null ? { baseUrl: parsed.baseUrl } : {}
  } catch {
    return {}
  }
}

export function writeConfig(ctx: Context, next: Config): void {
  ensureConfigDir(ctx)
  writeFileSync(configFile(ctx), `${JSON.stringify({ baseUrl: next.baseUrl }, null, 2)}\n`)
}

export function normalizeBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw usage('invalid_base_url', `not a URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw usage('invalid_base_url', 'base URL must be http or https')
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/** TEAMDA_BASE_URL wins over the config file, so CI never depends on local state. */
export function resolveBaseUrl(ctx: Context): string {
  const raw = ctx.env.TEAMDA_BASE_URL ?? readConfig(ctx).baseUrl
  if (!raw) {
    throw usage('base_url_missing', 'set TEAMDA_BASE_URL or run: teamda config set base-url <url>')
  }
  return normalizeBaseUrl(raw)
}
