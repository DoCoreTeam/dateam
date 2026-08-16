// lib/ci/net/ssrf.ts — 사용자가 준 주소를 서버가 대신 열 때의 방어 (서버 전용)
//
// 왜: 자료 링크 등록은 **사용자가 입력한 임의의 주소를 서버가 GET** 한다(fetchLinkMeta).
// 이 경로는 스킴만 검사했기 때문에 `http://169.254.169.254/...`(클라우드 메타데이터)나
// 내부망 주소를 넣으면 서버가 그 주소를 대신 열어 주고, 제목·og:image가 화면으로 새어 나왔다.
// 외부에서 못 닿는 곳을 우리 서버를 발판 삼아 닿게 하는 것 — SSRF다.
//
// 막는 방법은 하나뿐이다: **호스트를 IP로 풀어 보고, 그 IP가 공인 대역인지 확인한다.**
// 이름만 보면 안 된다(`nip.io` 같은 서비스가 공개 도메인으로 사설 IP를 가리킨다).
// 리다이렉트도 홉마다 다시 확인한다 — 첫 주소만 검사하면 302 한 번으로 뚫린다.

import { lookup } from 'node:dns/promises'

/** 리다이렉트 추적 상한. 무한 루프와 느린 체인을 함께 막는다. */
export const MAX_REDIRECT_HOPS = 3

/**
 * 왜 코드까지 두는가: "내부 주소라 막았다"와 "이름을 못 풀었다"는 다르게 다뤄야 한다.
 * 전자는 등록 자체를 거부하고, 후자는 등록은 허용하되 메타만 비운다(일시적 실패일 수 있다).
 * 문구로 분기하면 문구를 고치는 순간 보안 판정이 조용히 바뀐다.
 */
export type GuardCode = 'BAD_URL' | 'BAD_SCHEME' | 'PRIVATE' | 'UNRESOLVED'

export interface GuardResult {
  ok: boolean
  code: GuardCode | null
  /** 막았으면 그 사유. 사용자에게 보여줄 수 있는 말이어야 한다 */
  reason: string | null
}

const OK: GuardResult = { ok: true, code: null, reason: null }
const PRIVATE: GuardResult = { ok: false, code: 'PRIVATE', reason: '내부 주소는 열 수 없습니다' }
const UNRESOLVED: GuardResult = { ok: false, code: 'UNRESOLVED', reason: '주소를 확인하지 못했습니다' }

/**
 * 이름만으로 판별되는 내부 주소.
 * DNS를 타기 전에 걸러 낸다 — 해석 자체가 내부 DNS 질의가 되기 때문이다.
 */
export function isPrivateHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (!h) return true
  if (h === 'localhost') return true
  // 사내/컨테이너 이름공간. 공인 인터넷에서 쓰이지 않는 접미사다.
  return /\.(local|localhost|internal|intranet|home\.arpa)$/.test(h)
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let out = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n > 255) return null
    out = out * 256 + n
  }
  return out
}

/** [시작, 프리픽스길이] 쌍으로 적은 예약 대역들. 공인이 아닌 것은 전부 막는다. */
const V4_BLOCKED: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8],        // 현재 네트워크
  ['10.0.0.0', 8],       // 사설
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],      // 루프백
  ['169.254.0.0', 16],   // 링크로컬 — 클라우드 메타데이터(169.254.169.254)가 여기 있다
  ['172.16.0.0', 12],    // 사설
  ['192.0.0.0', 24],     // IETF 프로토콜 할당
  ['192.0.2.0', 24],     // 문서용
  ['192.168.0.0', 16],   // 사설
  ['198.18.0.0', 15],    // 벤치마크
  ['198.51.100.0', 24],  // 문서용
  ['203.0.113.0', 24],   // 문서용
  ['224.0.0.0', 4],      // 멀티캐스트
  ['240.0.0.0', 4],      // 예약 + 브로드캐스트
]

export function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip)
  if (value == null) return true // 못 읽는 주소는 안전한 쪽으로 판정한다
  for (const [base, bits] of V4_BLOCKED) {
    const start = ipv4ToInt(base)
    if (start == null) continue
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0
    if ((value & mask) >>> 0 === (start & mask) >>> 0) return true
  }
  return false
}

export function isPrivateIpv6(ip: string): boolean {
  const h = ip.toLowerCase().split('%')[0] // 존 인덱스(fe80::1%eth0) 제거
  if (h === '::' || h === '::1') return true
  // IPv4-mapped(::ffff:10.0.0.1) — v4 규칙으로 판정한다
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h)
  if (mapped) return isPrivateIpv4(mapped[1])
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true   // ULA fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true   // 링크로컬 fe80::/10
  if (/^ff[0-9a-f]{2}:/.test(h)) return true      // 멀티캐스트
  return false
}

export function isPrivateIp(ip: string): boolean {
  return ip.includes(':') ? isPrivateIpv6(ip) : isPrivateIpv4(ip)
}

/**
 * 주소 하나를 검사한다. http/https가 아니거나, 호스트가 내부로 풀리면 막는다.
 * DNS 해석기는 주입 가능하다 — 테스트가 실제 네트워크에 나가지 않게 하기 위해서다.
 */
export async function checkUrlIsPublic(
  raw: string,
  resolveHost: (host: string) => Promise<string[]> = defaultResolve,
): Promise<GuardResult> {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, code: 'BAD_URL', reason: '주소 형식을 확인해 주세요' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, code: 'BAD_SCHEME', reason: 'http/https 주소만 열 수 있습니다' }
  }

  // 대괄호로 감싼 IPv6 리터럴은 벗겨서 본다
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (isPrivateHostname(host)) return PRIVATE
  // IP를 그대로 넣은 경우 — DNS를 탈 필요가 없다
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    return isPrivateIp(host) ? PRIVATE : OK
  }

  let addresses: string[]
  try {
    addresses = await resolveHost(host)
  } catch {
    return UNRESOLVED
  }
  if (addresses.length === 0) return UNRESOLVED
  // 하나라도 내부를 가리키면 막는다. DNS 라운드로빈으로 우회되지 않게.
  if (addresses.some(isPrivateIp)) return PRIVATE
  return OK
}

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true })
  return records.map((r) => r.address)
}

export interface GuardedFetchOptions {
  signal?: AbortSignal
  headers?: Record<string, string>
  maxHops?: number
  resolveHost?: (host: string) => Promise<string[]>
}

/**
 * 검사를 통과한 주소만 연다. 리다이렉트는 직접 따라가며 **홉마다 다시 검사**한다.
 * 막히거나 실패하면 null — 호출부는 "메타를 못 얻었다"로 처리하면 된다.
 */
export async function guardedFetch(
  url: string,
  options: GuardedFetchOptions = {},
): Promise<Response | null> {
  const maxHops = options.maxHops ?? MAX_REDIRECT_HOPS
  let current = url

  for (let hop = 0; hop <= maxHops; hop += 1) {
    const verdict = await checkUrlIsPublic(current, options.resolveHost)
    if (!verdict.ok) return null

    const res = await fetch(current, {
      headers: options.headers,
      signal: options.signal,
      redirect: 'manual',
    })

    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) return res

    try {
      current = new URL(location, current).toString()
    } catch {
      return null
    }
  }
  return null // 홉을 다 써도 안 끝나면 포기한다
}
