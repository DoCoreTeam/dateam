/**
 * Copy the generated OpenAPI spec into the package so a compiled binary carries it.
 *
 * Source: apps/web/lib/actions/generated/openapi.json (written by the web app's cli:gen).
 * Target: src/generated/spec.json (imported by src/spec.ts, embedded by `bun build --compile`).
 *
 * Only rewrites the target when the content changed, so repeated builds leave git clean.
 * Usage: bun scripts/embed-spec.ts [sourcePath]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const PKG = join(import.meta.dir, '..')
const DEFAULT_SOURCE = join(PKG, '..', '..', 'apps', 'web', 'lib', 'actions', 'generated', 'openapi.json')
const TARGET = join(PKG, 'src', 'generated', 'spec.json')

const source = process.argv[2] ?? DEFAULT_SOURCE
if (!existsSync(source)) {
  console.error(JSON.stringify({ error: { code: 'spec_source_missing', message: `not found: ${source}` } }))
  process.exit(2)
}

const text = readFileSync(source, 'utf8')
const spec = JSON.parse(text) as { paths?: Record<string, Record<string, { 'x-cli'?: string }>> }
const count = Object.values(spec.paths ?? {}).flatMap((ops) => Object.values(ops)).filter((o) => o['x-cli']).length
if (count === 0) {
  console.error(JSON.stringify({ error: { code: 'spec_invalid', message: 'source spec has no x-cli operations' } }))
  process.exit(8)
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const previous = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : ''
const changed = sha(previous) !== sha(text)
if (changed) {
  mkdirSync(dirname(TARGET), { recursive: true })
  writeFileSync(TARGET, text)
}
console.log(JSON.stringify({ target: 'src/generated/spec.json', operations: count, sha256: sha(text), changed }))
