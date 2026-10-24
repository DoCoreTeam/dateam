/**
 * teamda 실행 파일 보관함의 목록 (P0167 I02)
 *
 * 버킷 cli-release 맨 위의 latest.json 이 지금 내려줄 판을 말한다
 * 올리는 쪽은 packages/teamda-cli/scripts/publish.ts 하나, 읽는 쪽은 app/api/cli/release
 * 목록은 버킷에서 읽은 바깥 값이라 여기서 모양과 경로를 검증한 값만 창구가 쓴다
 * DB 와 Next 를 모르는 순수 함수만 둔다, manifest.test.ts 가 그대로 부른다
 */

export const RELEASE_BUCKET = 'cli-release'
export const MANIFEST_PATH = 'latest.json'
/** 서명 주소 수명, 눌러서 받기에 충분하고 새어도 곧 죽는다 */
export const SIGNED_URL_TTL_SECONDS = 600

export const RELEASE_TARGETS = ['windows-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'] as const
export type ReleaseTarget = (typeof RELEASE_TARGETS)[number]

export interface ReleaseFile {
  target: ReleaseTarget
  /** 버킷 안 경로, v버전/파일이름 */
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

export type ParseResult = { ok: true; manifest: ReleaseManifest } | { ok: false; reason: string }

const VERSION_RE = /^\d+\.\d+\.\d+$/
const FILE_NAME_RE = /^teamda-[a-z0-9-]+\.(zip|tar\.gz)$/
const SHA256_RE = /^[0-9a-f]{64}$/
const MAX_FILE_BYTES = 104_857_600

/** 버킷 경로는 v버전/파일이름 한 꼴만 받는다, ../ 와 절대 경로와 다른 판 폴더는 거절 */
export function isSafeReleasePath(p: string, version: string, fileName: string): boolean {
  if (typeof p !== 'string' || p.startsWith('/') || p.includes('\\') || p.includes('..')) return false
  return p === `v${version}/${fileName}`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseFile(raw: unknown, version: string, i: number): ReleaseFile | string {
  if (!isRecord(raw)) return `files[${i}] 가 객체가 아님`
  const { target, path, fileName, size, sha256 } = raw
  if (typeof target !== 'string' || !(RELEASE_TARGETS as readonly string[]).includes(target)) return `files[${i}].target 이 모르는 값`
  if (typeof fileName !== 'string' || !FILE_NAME_RE.test(fileName)) return `files[${i}].fileName 이 형식에 안 맞음`
  if (typeof path !== 'string' || !isSafeReleasePath(path, version, fileName)) return `files[${i}].path 가 v${version}/${String(fileName)} 이 아님`
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES) return `files[${i}].size 가 범위 밖`
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) return `files[${i}].sha256 이 64자리 16진수가 아님`
  return { target: target as ReleaseTarget, path, fileName, size, sha256 }
}

export function parseManifest(raw: unknown): ParseResult {
  if (!isRecord(raw)) return { ok: false, reason: '목록이 객체가 아님' }
  const { version, publishedAt, files } = raw
  if (typeof version !== 'string' || !VERSION_RE.test(version)) return { ok: false, reason: 'version 이 0.0.0 꼴이 아님' }
  if (typeof publishedAt !== 'string' || Number.isNaN(Date.parse(publishedAt))) return { ok: false, reason: 'publishedAt 이 날짜가 아님' }
  if (!Array.isArray(files) || files.length === 0) return { ok: false, reason: 'files 가 비었음' }
  const parsed: ReleaseFile[] = []
  for (let i = 0; i < files.length; i++) {
    const f = parseFile(files[i], version, i)
    if (typeof f === 'string') return { ok: false, reason: f }
    if (parsed.some((p) => p.target === f.target)) return { ok: false, reason: `files[${i}].target 이 겹침` }
    parsed.push(f)
  }
  return { ok: true, manifest: { version, publishedAt, files: parsed } }
}
