/**
 * `teamda sync`: fetch the server spec, cache it only when its sha256 differs.
 *
 * The hash is taken over the spec object serialized with JSON.stringify, so envelope fields
 * and whitespace in the response do not count as a change.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '../context.ts'
import { configDir, ensureConfigDir, resolveBaseUrl } from '../config.ts'
import { CliError, EXIT } from '../exit.ts'
import { request } from '../http.ts'
import {
  SYNCED_HASH_FILE, SYNCED_SPEC_FILE, buildCommandTree, countCliOperations, sha256, type OpenApiSpec,
} from '../spec.ts'
import { joinUrl } from './invoke.ts'

export const SPEC_PATH = '/api/public/v1/openapi.json'

export interface SyncResult {
  updated: boolean
  sha256: string
  previous: string | null
  operations: number
  file: string
}

function unwrap(body: unknown): OpenApiSpec | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as { paths?: unknown; data?: { paths?: unknown } }
  if (b.paths) return b as OpenApiSpec
  if (b.data && typeof b.data === 'object' && b.data.paths) return b.data as OpenApiSpec
  return null
}

export async function sync(ctx: Context, key: string | null): Promise<SyncResult> {
  if (!key) throw new CliError(EXIT.AUTH, { code: 'auth_missing', message: 'no API key: run teamda auth login --key-file <path>, or set TEAMDA_API_KEY' })
  const base = resolveBaseUrl(ctx)
  const body = await request(ctx, { method: 'GET', url: joinUrl(base, '', SPEC_PATH), key })
  const spec = unwrap(body)
  const operations = spec ? countCliOperations(spec) : 0
  // A spec without x-cli would leave an empty command tree; keep the current one instead.
  if (!spec || operations === 0) {
    throw new CliError(EXIT.SERVER, { code: 'spec_invalid', message: 'server spec has no x-cli operations; cache left unchanged' })
  }
  try {
    buildCommandTree(spec)
  } catch (e) {
    throw new CliError(EXIT.SERVER, { code: 'spec_invalid', message: e instanceof Error ? e.message : 'invalid spec' })
  }
  const text = JSON.stringify(spec)
  const hash = sha256(text)
  const dir = ensureConfigDir(ctx)
  const specFile = join(dir, SYNCED_SPEC_FILE)
  const hashFile = join(dir, SYNCED_HASH_FILE)
  const previous = existsSync(hashFile) && existsSync(specFile) ? readFileSync(hashFile, 'utf8').trim() : null
  const updated = previous !== hash
  if (updated) {
    writeFileSync(specFile, text)
    writeFileSync(hashFile, `${hash}\n`)
  }
  return { updated, sha256: hash, previous, operations, file: specFile }
}

/** Hash of the spec in use, for help output. */
export function specHash(ctx: Context, source: 'synced' | 'embedded', spec: OpenApiSpec): string | null {
  if (source === 'embedded') return spec['x-spec-hash'] ?? null
  const hashFile = join(configDir(ctx), SYNCED_HASH_FILE)
  return existsSync(hashFile) ? readFileSync(hashFile, 'utf8').trim() : null
}
