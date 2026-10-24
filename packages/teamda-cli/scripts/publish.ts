/**
 * Build teamda for every target, pack each binary, and upload them with latest.json (P0167 I03).
 *
 *   bun scripts/publish.ts --dry-run   build, pack and hash only, nothing leaves this machine
 *   bun --env-file=../../apps/web/.env.local scripts/publish.ts
 *   bun --env-file=../../apps/web/.env.local scripts/publish.ts --force   replace files of the same version
 *
 * Upload reads NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY from the
 * environment only and never prints the key. Bucket paths are always v<version>/<fileName>, and
 * latest.json goes last so the download page never points at a file that is not there yet.
 * The manifest is checked with the same parseManifest the web route uses before anything uploads.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  MANIFEST_PATH, RELEASE_BUCKET, parseManifest,
  type ReleaseFile, type ReleaseManifest, type ReleaseTarget,
} from '../../../apps/web/lib/cli-release/manifest.ts'

const PKG = join(import.meta.dir, '..')
const OUT = join(PKG, 'dist', 'release')

interface TargetSpec {
  target: ReleaseTarget
  bunTarget: string
  binary: string
  archive: 'zip' | 'tar.gz'
}

const TARGETS: readonly TargetSpec[] = [
  { target: 'windows-x64', bunTarget: 'bun-windows-x64-baseline', binary: 'teamda.exe', archive: 'zip' },
  { target: 'darwin-arm64', bunTarget: 'bun-darwin-arm64', binary: 'teamda', archive: 'tar.gz' },
  { target: 'darwin-x64', bunTarget: 'bun-darwin-x64', binary: 'teamda', archive: 'tar.gz' },
  { target: 'linux-x64', bunTarget: 'bun-linux-x64-baseline', binary: 'teamda', archive: 'tar.gz' },
]

function fail(code: string, message: string): never {
  console.error(JSON.stringify({ error: { code, message } }))
  process.exit(1)
}

function run(cmd: string[], cwd: string): void {
  const r = Bun.spawnSync(cmd, { cwd, stdout: 'ignore', stderr: 'pipe' })
  if (r.exitCode !== 0) fail('command_failed', `${cmd.slice(0, 3).join(' ')}: ${r.stderr.toString().slice(0, 400)}`)
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function buildOne(spec: TargetSpec, version: string): ReleaseFile {
  const dir = join(OUT, spec.target)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  run(['bun', 'build', 'src/main.ts', '--compile', `--target=${spec.bunTarget}`, '--outfile', join(dir, spec.binary)], PKG)
  const fileName = `teamda-${spec.target}.${spec.archive}`
  const archivePath = join(OUT, fileName)
  rmSync(archivePath, { force: true })
  if (spec.archive === 'zip') run(['zip', '-q', '-j', archivePath, join(dir, spec.binary)], PKG)
  else run(['tar', '-czf', archivePath, '-C', dir, spec.binary], PKG)
  return { target: spec.target, path: `v${version}/${fileName}`, fileName, size: statSync(archivePath).size, sha256: sha256Of(archivePath) }
}

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as { version?: string }
  if (!pkg.version) fail('version_missing', 'package.json has no version')
  return pkg.version
}

function buildManifest(version: string): ReleaseManifest {
  run(['bun', 'scripts/embed-spec.ts'], PKG)
  const files = TARGETS.map((t) => {
    const f = buildOne(t, version)
    console.log(JSON.stringify({ built: f.fileName, size: f.size, sha256: f.sha256 }))
    return f
  })
  const parsed = parseManifest({ version, publishedAt: new Date().toISOString(), files })
  if (!parsed.ok) fail('manifest_invalid', parsed.reason)
  return parsed.manifest
}

interface UploadEnv { baseUrl: string; key: string }

function readUploadEnv(): UploadEnv {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!baseUrl || !key) fail('env_missing', 'set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (bun --env-file=...)')
  return { baseUrl: baseUrl.replace(/\/+$/, ''), key }
}

async function upload(env: UploadEnv, objectPath: string, body: Blob, contentType: string, upsert: boolean): Promise<void> {
  const url = `${env.baseUrl}/storage/v1/object/${RELEASE_BUCKET}/${objectPath}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.key}`, apikey: env.key, 'content-type': contentType, 'x-upsert': String(upsert), 'cache-control': 'no-cache' },
    body,
  })
  if (!res.ok) fail('upload_failed', `${objectPath}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  console.log(JSON.stringify({ uploaded: objectPath }))
}

async function publish(manifest: ReleaseManifest, force: boolean): Promise<void> {
  const env = readUploadEnv()
  for (const f of manifest.files) {
    const type = f.fileName.endsWith('.zip') ? 'application/zip' : 'application/gzip'
    await upload(env, f.path, Bun.file(join(OUT, f.fileName)), type, force)
  }
  await upload(env, MANIFEST_PATH, new Blob([JSON.stringify(manifest, null, 2)]), 'application/json', true)
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const dryRun = args.has('--dry-run')
  const manifest = buildManifest(readVersion())
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, manifest }, null, 2))
    return
  }
  await publish(manifest, args.has('--force'))
  console.log(JSON.stringify({ published: manifest.version, files: manifest.files.length }))
}

await main()
