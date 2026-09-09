/**
 * 첨부 묶음 풀기 (설계서 3.2.2)
 *
 * ## 왜 ZIP 을 직접 읽나
 *
 * 압축 해제 라이브러리는 대개 **먼저 다 풀고 나서** 결과를 준다.
 * 그러면 압축 폭탄을 막을 자리가 없다 — 42KB 짜리가 4GB 로 펴지는 동안 서버가 죽는다.
 * 중앙 디렉터리에 적힌 «펴진 크기»를 먼저 읽고, 상한을 넘으면 **풀기 전에** 거절해야 한다.
 * 그 판단을 하려면 ZIP 구조를 우리가 들고 있어야 한다.
 *
 * ## 중첩은 1단계까지
 *
 * 나라장터 첨부는 ZIP 안에 ZIP 이 흔하다(공고 묶음 안의 서식 묶음).
 * 그런데 깊이를 열어 두면 폭탄이 깊이로 도망간다. 1단계면 실제 묶음은 다 풀리고
 * 그보다 깊은 것은 사람이 보게 하는 편이 낫다.
 */

import { inflateRawSync } from 'node:zlib'

/** 펴진 총량 상한 — 넘으면 풀기 전에 거절한다 */
export const MAX_TOTAL_UNCOMPRESSED = 512 * 1024 * 1024
/** 파일 하나의 상한 */
export const MAX_ENTRY_UNCOMPRESSED = 128 * 1024 * 1024
/** 파일 개수 상한 */
export const MAX_ENTRIES = 500
/** 중첩 깊이 — 0 이 바깥 ZIP, 1 이 그 안의 ZIP */
export const MAX_NESTING = 1
/** 압축비 상한. 이보다 잘 압축됐으면 폭탄으로 본다 */
export const MAX_RATIO = 200

export interface BundleEntry {
  /** ZIP 안 경로. 중첩이면 `바깥.zip/안쪽.hwp` 처럼 이어 붙인다 */
  path: string
  fileName: string
  bytes: Uint8Array
  /** 몇 겹 안에서 나왔나 */
  depth: number
}

export type BundleRejectReason =
  | 'too_many_entries'
  | 'too_large'
  | 'entry_too_large'
  | 'suspicious_ratio'
  | 'path_traversal'
  | 'corrupt'

export type BundleResult =
  | { ok: true; entries: BundleEntry[]; skipped: { path: string; reason: BundleRejectReason }[] }
  | { ok: false; reason: BundleRejectReason; detail: string }

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

interface CentralEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
}

/**
 * 중앙 디렉터리를 읽는다 — **아직 아무것도 풀지 않는다.**
 * 여기서 얻은 «펴진 크기» 로 폭탄을 먼저 거른다.
 */
function readCentralDirectory(buf: Buffer): CentralEntry[] | null {
  // EOCD 는 파일 끝에 있고 주석 때문에 위치가 흔들린다. 뒤에서부터 찾는다
  const maxBack = Math.min(buf.length, 65_557)
  let eocd = -1
  for (let i = buf.length - 22; i >= buf.length - maxBack && i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break }
  }
  if (eocd < 0) return null

  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  const entries: CentralEntry[] = []

  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length) return null
    if (buf.readUInt32LE(offset) !== SIG_CENTRAL) return null
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const uncompressedSize = buf.readUInt32LE(offset + 24)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8')
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 디렉터리 항목인가 — 이름이 / 로 끝나면 내용이 없다 */
function isDirectory(e: CentralEntry): boolean {
  return e.name.endsWith('/')
}

/**
 * `../` 로 바깥을 가리키는 이름을 막는다.
 * 우리는 디스크에 쓰지 않지만, 이 경로가 나중에 저장소 키로 쓰이면 그때 터진다.
 */
function hasTraversal(name: string): boolean {
  return name.includes('..') || name.startsWith('/') || /^[a-z]:/i.test(name)
}

function inflateEntry(buf: Buffer, e: CentralEntry): Uint8Array | null {
  const off = e.localOffset
  if (off + 30 > buf.length) return null
  if (buf.readUInt32LE(off) !== SIG_LOCAL) return null
  // 로컬 헤더의 이름·부가 길이는 중앙 디렉터리와 다를 수 있다. 로컬 값을 쓴다
  const nameLen = buf.readUInt16LE(off + 26)
  const extraLen = buf.readUInt16LE(off + 28)
  const start = off + 30 + nameLen + extraLen
  const end = start + e.compressedSize
  if (end > buf.length) return null

  const raw = buf.subarray(start, end)
  if (e.method === 0) return new Uint8Array(raw)          // 저장(무압축)
  if (e.method !== 8) return null                          // deflate 외는 안 다룬다
  try {
    return new Uint8Array(inflateRawSync(raw))
  } catch {
    return null
  }
}

export interface UnbundleOptions {
  /** 지금 몇 겹 안인가. 바깥에서 부를 때는 0 */
  depth?: number
  /** 이름 앞에 붙일 경로 */
  prefix?: string
}

/**
 * ZIP 을 풀어 파일 목록을 돌려준다.
 *
 * 폭탄은 **거절**하고, 개별 파일 문제는 건너뛴 목록으로 돌려준다 —
 * 서식 하나가 깨졌다고 공고 묶음 전체를 못 읽게 만들 이유가 없다.
 */
export function unbundle(bytes: Uint8Array, opts: UnbundleOptions = {}): BundleResult {
  const depth = opts.depth ?? 0
  const prefix = opts.prefix ?? ''
  const buf = Buffer.from(bytes)

  const central = readCentralDirectory(buf)
  if (!central) return { ok: false, reason: 'corrupt', detail: '중앙 디렉터리를 못 읽었다' }

  const files = central.filter((e) => !isDirectory(e))
  if (files.length > MAX_ENTRIES) {
    return { ok: false, reason: 'too_many_entries', detail: `${files.length} > ${MAX_ENTRIES}` }
  }

  // 풀기 전에 «적혀 있는 크기» 로 먼저 판단한다
  const declaredTotal = files.reduce((n, e) => n + e.uncompressedSize, 0)
  if (declaredTotal > MAX_TOTAL_UNCOMPRESSED) {
    return { ok: false, reason: 'too_large', detail: `${declaredTotal} > ${MAX_TOTAL_UNCOMPRESSED}` }
  }

  const entries: BundleEntry[] = []
  const skipped: { path: string; reason: BundleRejectReason }[] = []
  let total = 0

  for (const e of files) {
    const path = prefix ? `${prefix}/${e.name}` : e.name

    if (hasTraversal(e.name)) { skipped.push({ path, reason: 'path_traversal' }); continue }
    if (e.uncompressedSize > MAX_ENTRY_UNCOMPRESSED) {
      skipped.push({ path, reason: 'entry_too_large' }); continue
    }
    // 압축비가 비정상이면 폭탄이다. 작은 파일은 비율이 크게 나오므로 하한을 둔다
    if (e.compressedSize > 1024 && e.uncompressedSize / Math.max(1, e.compressedSize) > MAX_RATIO) {
      skipped.push({ path, reason: 'suspicious_ratio' }); continue
    }

    const data = inflateEntry(buf, e)
    if (!data) { skipped.push({ path, reason: 'corrupt' }); continue }

    // 실제로 편 양도 센다 — 헤더에 적힌 크기는 거짓일 수 있다
    total += data.length
    if (total > MAX_TOTAL_UNCOMPRESSED) {
      return { ok: false, reason: 'too_large', detail: `실제 해제 ${total} > ${MAX_TOTAL_UNCOMPRESSED}` }
    }

    if (isZip(data) && depth < MAX_NESTING) {
      const inner = unbundle(data, { depth: depth + 1, prefix: path })
      if (inner.ok) {
        entries.push(...inner.entries)
        skipped.push(...inner.skipped)
      } else {
        skipped.push({ path, reason: inner.reason })
      }
      continue
    }

    entries.push({ path, fileName: baseName(e.name), bytes: data, depth })
  }

  return { ok: true, entries, skipped }
}

function baseName(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}
