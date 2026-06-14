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
  if (a >= 224) return true // 멀티캐스트/예약
  return false
}

/** 사설/예약 IPv6 대역인가 */
function isPrivateIPv6(ip: string): boolean {
  const x = ip.toLowerCase()
  if (x === '::1' || x === '::') return true // loopback/unspecified
  if (x.startsWith('fe80')) return true // link-local
  if (x.startsWith('fc') || x.startsWith('fd')) return true // unique local fc00::/7
  // IPv4-mapped ::ffff:a.b.c.d → 내부 IPv4 검사
  const m = x.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (m) return isPrivateIPv4(m[1])
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
  const host = u.hostname
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

/**
 * SSRF 안전 fetch + 본문 텍스트(상한 적용). 리다이렉트는 수동 추적하며 홉마다 재검증한다.
 * 반환: { ok, status, text } — 실패/비ok 시 ok:false, text:''.
 * 차단(SsrfBlockedError)은 throw 하지 않고 ok:false 로 흡수(호출부 단순화). blockedReason에 사유.
 */
export async function safeFetchText(
  rawUrl: string,
  init?: { headers?: Record<string, string>; timeoutMs?: number },
): Promise<{ ok: boolean; status: number; text: string; blockedReason?: string }> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
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
        if (!loc) return { ok: false, status: res.status, text: '' }
        current = new URL(loc, safe).toString()
        continue
      }
      if (!res.ok) return { ok: false, status: res.status, text: '' }

      // 크기 상한 — Content-Length 선검사
      const cl = Number(res.headers.get('content-length') ?? '0')
      if (cl > MAX_BYTES) return { ok: false, status: 413, text: '', blockedReason: 'too_large' }

      // 스트리밍 누적 상한
      const reader = res.body?.getReader()
      if (!reader) {
        const t = await res.text()
        return { ok: true, status: res.status, text: t.slice(0, MAX_BYTES) }
      }
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          total += value.byteLength
          if (total > MAX_BYTES) {
            try { await reader.cancel() } catch { /* noop */ }
            break
          }
          chunks.push(value)
        }
      }
      const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8')
      return { ok: true, status: res.status, text }
    }
    return { ok: false, status: 508, text: '', blockedReason: 'too_many_redirects' }
  } catch (e) {
    if (e instanceof SsrfBlockedError) {
      return { ok: false, status: 0, text: '', blockedReason: e.message }
    }
    return { ok: false, status: 0, text: '' }
  } finally {
    clearTimeout(timer)
  }
}
