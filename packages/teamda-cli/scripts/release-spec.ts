/**
 * Release contract shared by the uploader and the web download route (P0167 I04a).
 *
 * The package must not import repository code (apps/web/lib/policy/ai-package-boundary.test.ts),
 * so the contract lives here and apps/web/lib/cli-release/manifest.test.ts checks it against the
 * web validator: same bucket, same manifest name, same targets, and a manifest built from these
 * helpers must pass parseManifest. Pure values and functions only, no I/O.
 */

export const RELEASE_BUCKET = 'cli-release'
export const MANIFEST_PATH = 'latest.json'

export type ReleaseTarget = 'windows-x64' | 'darwin-arm64' | 'darwin-x64' | 'linux-x64'

export interface TargetSpec {
  target: ReleaseTarget
  bunTarget: string
  binary: string
  archive: 'zip' | 'tar.gz'
}

export const TARGETS: readonly TargetSpec[] = [
  { target: 'windows-x64', bunTarget: 'bun-windows-x64-baseline', binary: 'teamda.exe', archive: 'zip' },
  { target: 'darwin-arm64', bunTarget: 'bun-darwin-arm64', binary: 'teamda', archive: 'tar.gz' },
  { target: 'darwin-x64', bunTarget: 'bun-darwin-x64', binary: 'teamda', archive: 'tar.gz' },
  { target: 'linux-x64', bunTarget: 'bun-linux-x64-baseline', binary: 'teamda', archive: 'tar.gz' },
]

export interface ReleaseFile {
  target: ReleaseTarget
  path: string
  fileName: string
  size: number
  sha256: string
}

export interface ReleaseManifest {
  version: string
  publishedAt: string
  files: ReleaseFile[]
}

const VERSION_RE = /^\d+\.\d+\.\d+$/
const SHA256_RE = /^[0-9a-f]{64}$/

export function archiveNameOf(spec: TargetSpec): string {
  return `teamda-${spec.target}.${spec.archive}`
}

/** Bucket path is always v<version>/<fileName>, the only shape the download route accepts */
export function objectPathOf(version: string, fileName: string): string {
  return `v${version}/${fileName}`
}

export function releaseFileOf(spec: TargetSpec, version: string, size: number, sha256: string): ReleaseFile {
  const fileName = archiveNameOf(spec)
  return { target: spec.target, path: objectPathOf(version, fileName), fileName, size, sha256 }
}

/** Refuse to upload anything the route would reject, so a bad build never reaches the bucket */
export function checkManifest(m: ReleaseManifest): string | null {
  if (!VERSION_RE.test(m.version)) return 'version is not x.y.z'
  if (Number.isNaN(Date.parse(m.publishedAt))) return 'publishedAt is not a date'
  if (m.files.length !== TARGETS.length) return `expected ${TARGETS.length} files, got ${m.files.length}`
  for (const f of m.files) {
    if (f.path !== objectPathOf(m.version, f.fileName)) return `${f.fileName}: path is not v${m.version}/${f.fileName}`
    if (!Number.isInteger(f.size) || f.size <= 0) return `${f.fileName}: size is not positive`
    if (!SHA256_RE.test(f.sha256)) return `${f.fileName}: sha256 is not 64 hex chars`
  }
  return null
}
