// 복귀 경로 SSOT — "설정하고 돌아오면 원래 있던 화면으로"
//
// 왜 있나: 외부로 나갔다 돌아오는 흐름(OAuth 동의, 결제, 외부 인증)이 끝나면
// 사용자는 **떠났던 그 화면**으로 돌아와야 한다. 그런데 각 라우트가 복귀 주소를
// 직접 하드코딩하면 쿼리(탭·필터·스크롤 기준)가 통째로 날아간다.
// (실제 사고: Google Drive 콜백이 '/admin/settings?drive=connected'로 고정돼 있어
//  `?tab=integrations`가 사라졌고, 연동을 마치면 엉뚱하게 '브랜딩' 탭이 열렸다)
//
// 새 외부 왕복 흐름을 만들 때는 이 모듈만 쓴다. 복귀 주소를 라우트에 적지 않는다.

/** 왕복 흐름에서 복귀 주소를 실어 나르는 쿼리 파라미터 이름 */
export const RETURN_TO_PARAM = 'returnTo'

/** 복귀 주소를 알 수 없을 때의 최후 기본값 */
export const RETURN_TO_FALLBACK = '/home'

/**
 * 외부에서 들어온 복귀 주소를 안전한 내부 경로로만 통과시킨다.
 *
 * 열린 리다이렉트(open redirect) 방어 — 아래는 전부 차단하고 fallback으로 떨군다:
 *  · 절대 URL (`https://evil.com`)         — 외부 사이트로 튕김
 *  · 프로토콜 상대 (`//evil.com`)          — 브라우저가 절대 URL로 해석
 *  · 백슬래시 우회 (`/\evil.com`, `/\/`)   — 일부 브라우저가 `//`로 해석
 *  · CR/LF 포함                            — 헤더 인젝션
 */
export function sanitizeReturnTo(
  raw: string | null | undefined,
  fallback: string = RETURN_TO_FALLBACK,
): string {
  if (!raw) return fallback
  if (raw.length > 2048) return fallback
  if (/[\r\n\t]/.test(raw)) return fallback
  if (!raw.startsWith('/')) return fallback
  // '//' 와 '/\' 는 둘 다 외부로 나갈 수 있다
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  return raw
}

/**
 * 경로에 쿼리를 덧붙인다. 이미 있는 쿼리는 보존하고 같은 키만 덮어쓴다.
 * (복귀 주소의 `?tab=integrations`를 살린 채 `drive=connected`만 얹기 위한 것)
 */
export function appendParams(path: string, params: Record<string, string>): string {
  const [base, hash] = path.split('#')
  const [pathname, query = ''] = base.split('?')
  const search = new URLSearchParams(query)
  for (const [k, v] of Object.entries(params)) search.set(k, v)
  const qs = search.toString()
  return `${pathname}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`
}

/** `href`에 복귀 주소를 실어 보낸다. 왕복 흐름을 시작하는 쪽이 호출한다. */
export function withReturnTo(href: string, returnTo: string): string {
  return appendParams(href, { [RETURN_TO_PARAM]: sanitizeReturnTo(returnTo) })
}

/**
 * 지금 보고 있는 화면(경로+쿼리)을 복귀 지점으로 만든다. 클라이언트 전용.
 * 쿼리를 포함해야 탭·필터가 유지된다.
 */
export function currentReturnTo(): string {
  if (typeof window === 'undefined') return RETURN_TO_FALLBACK
  return sanitizeReturnTo(window.location.pathname + window.location.search)
}
