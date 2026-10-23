// lib/security/safe-fetch.ts — SSRF 방어 SSOT (외부 URL 크롤 공용)
//
// 위협: DB에 저장된 경쟁사 URL(competitor_url/pricing_url)을 서버가 그대로 fetch → 공격자가 사설망/
//   클라우드 메타데이터(169.254.169.254) URL을 심으면 내부 자원·크리덴셜 탈취, 거대 응답으로 OOM.
//
// 방어:
//   1) 스킴 화이트리스트 http(s)만 (javascript:/file:/gopher:/data: 차단)
//   2) 호스트 DNS resolve → 사설/loopback/link-local/메타데이터 IP 차단 (IPv4/IPv6)
//   3) redirect: 'manual' + 홉마다 재검증 (리다이렉트로 우회 차단), 최대 4홉
//   4) Content-Length + 스트리밍 누적 상한(기본 2MB)으로 OOM 차단
//   5) 타임아웃(기본 12s)
//
// 사용: review·market/refresh 의 외부 본문 수집이 이 모듈을 경유한다.

import { lookup } from 'node:dns/promises'
import net from 'node:net'

const MAX_BYTES = 2 * 1024 * 1024 // 2MB
const MAX_REDIRECTS = 4
const DEFAULT_TIMEOUT_MS = 12_000

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfBlockedError'
  }
}

/** 사설/예약 IPv4 대역인가 */
function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true // 파싱 실패 = 차단
  const [a, b] = p
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // loopback
  if (a === 0) return true // 0.0.0.0/8
  if (a === 169 && b === 254) return true // link-local + 메타데이터(169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) return true // 192.0.0/24 IETF, 192.0.2/24 문서용
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15 벤치마크
  if (a >= 224) return true // 멀티캐스트/예약
  return false
}

/** IPv6 를 16비트 여덟 칸으로 편다, 못 펴면 null */
function expandIPv6(ip: string): number[] | null {
  let x = ip.toLowerCase().split('%')[0]
  // 끝이 a.b.c.d 면 두 칸으로 바꾼다
  const v4 = x.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const p = v4[1].split('.').map(Number)
    if (p.some((n) => Number.isNaN(n) || n > 255)) return null
    x = x.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`
  }
  const halves = x.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  if (fill < 0) return null
  const groups = [...head, ...Array(fill).fill('0'), ...tail]
  if (groups.length !== 8) return null
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN))
  return nums.some(Number.isNaN) ? null : nums
}

function v4FromGroups(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
}

/** 사설/예약 IPv6 대역인가, 안에 IPv4 를 품은 표기는 그 IPv4 로 다시 본다 */
function isPrivateIPv6(ip: string): boolean {
  const g = expandIPv6(ip)
  if (!g) return true // 파싱 실패 = 차단
  const zeroUntil = (n: number) => g.slice(0, n).every((v) => v === 0)
  if (zeroUntil(6)) return isPrivateIPv4(v4FromGroups(g[6], g[7])) // ::, ::1, ::a.b.c.d 는 0.x 와 품은 IPv4
  if (zeroUntil(5) && g[5] === 0xffff) return isPrivateIPv4(v4FromGroups(g[6], g[7])) // ::ffff:a.b.c.d
  if (zeroUntil(4) && g[4] === 0xffff && g[5] === 0) return isPrivateIPv4(v4FromGroups(g[6], g[7])) // ::ffff:0:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateIPv4(v4FromGroups(g[6], g[7])) // NAT64 64:ff9b::/96 과 /48
  if (g[0] === 0x2002) return isPrivateIPv4(v4FromGroups(g[1], g[2])) // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true // 문서용
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true // 버림 100::/64
  if ((g[0] & 0xffc0) === 0xfe80) return true // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true // site-local fec0::/10
  if ((g[0] & 0xfe00) === 0xfc00) return true // unique local fc00::/7
  if ((g[0] & 0xff00) === 0xff00) return true // 멀티캐스트
  return false
}

function isBlockedIp(ip: string): boolean {
  const fam = net.isIP(ip)
  if (fam === 4) return isPrivateIPv4(ip)
  if (fam === 6) return isPrivateIPv6(ip)
  return true // IP로 인식 안 됨 = 차단
}

/** URL 스킴·호스트 DNS를 검증. 위반 시 throw. 통과하면 정규화된 URL 반환. */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    throw new SsrfBlockedError('유효하지 않은 URL')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfBlockedError(`허용되지 않은 스킴: ${u.protocol}`)
  }
  // URL 은 IPv6 를 [::1] 로 감싸 준다, 벗겨야 IP 로 읽힌다
  const host = u.hostname.replace(/^\[|\]$/g, '')
  // 호스트가 직접 IP인 경우
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfBlockedError(`사설/예약 IP 차단: ${host}`)
    return u
  }
  // 도메인 → 모든 resolve 주소 검증 (DNS rebinding 일부 완화)
  let addrs: { address: string }[]
  try {
    addrs = await lookup(host, { all: true })
  } catch {
    throw new SsrfBlockedError(`DNS 해석 실패: ${host}`)
  }
  if (addrs.length === 0) throw new SsrfBlockedError(`주소 없음: ${host}`)
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new SsrfBlockedError(`사설/예약 IP로 해석됨: ${host} → ${a.address}`)
  }
  return u
}

export interface SafeFetchInit {
  headers?: Record<string, string>
  timeoutMs?: number
  /** 본문 상한(기본 2MB), 넘으면 ok:false 와 too_large */
  maxBytes?: number
  /** 스트리밍 중 넘치면 실패 대신 잘라서 돌려줌 (텍스트 수집용) */
  truncateOverflow?: boolean
}

export interface SafeFetchBytesResult {
  ok: boolean
  status: number
  bytes: Buffer
  contentType: string | null
  blockedReason?: string
}

const EMPTY = Buffer.alloc(0)

/**
 * SSRF 안전 fetch + 본문 바이트(상한 적용). 리다이렉트는 수동 추적하며 홉마다 재검증한다.
 * 차단(SsrfBlockedError)은 throw 하지 않고 ok:false 로 흡수(호출부 단순화). blockedReason에 사유.
 */
export async function safeFetchBytes(rawUrl: string, init?: SafeFetchInit): Promise<SafeFetchBytesResult> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = init?.maxBytes ?? MAX_BYTES
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const fail = (status: number, blockedReason?: string): SafeFetchBytesResult =>
    ({ ok: false, status, bytes: EMPTY, contentType: null, blockedReason })
  let current = rawUrl
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const safe = await assertSafeUrl(current) // 홉마다 재검증
      const res = await fetch(safe.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: init?.headers ?? {},
      })
      // 수동 리다이렉트 처리
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) return fail(res.status)
        current = new URL(loc, safe).toString()
        continue
      }
      if (!res.ok) return fail(res.status)

      // 크기 상한 — Content-Length 선검사
      const cl = Number(res.headers.get('content-length') ?? '0')
      if (cl > maxBytes) return fail(413, 'too_large')

      const bytes = await readCapped(res, maxBytes, init?.truncateOverflow ?? false)
      if (!bytes) return fail(413, 'too_large')
      return { ok: true, status: res.status, bytes, contentType: res.headers.get('content-type') }
    }
    return fail(508, 'too_many_redirects')
  } catch (e) {
    if (e instanceof SsrfBlockedError) return fail(0, e.message)
    return fail(0)
  } finally {
    clearTimeout(timer)
  }
}

/** 스트리밍 누적 상한, 넘으면 null 또는 잘라서 */
async function readCapped(res: Response, maxBytes: number, truncate: boolean): Promise<Buffer | null> {
  const reader = res.body?.getReader()
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength <= maxBytes) return buf
    return truncate ? buf.subarray(0, maxBytes) : null
  }
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      try { await reader.cancel() } catch { /* noop */ }
      return truncate ? Buffer.concat(chunks) : null
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/**
 * SSRF 안전 fetch + 본문 텍스트(상한 적용).
 * 반환: { ok, status, text } — 실패/비ok 시 ok:false, text:''.
 */
export async function safeFetchText(
  rawUrl: string,
  init?: { headers?: Record<string, string>; timeoutMs?: number },
): Promise<{ ok: boolean; status: number; text: string; blockedReason?: string }> {
  const r = await safeFetchBytes(rawUrl, { ...init, truncateOverflow: true })
  return { ok: r.ok, status: r.status, text: r.ok ? r.bytes.toString('utf8') : '', blockedReason: r.blockedReason }
}
