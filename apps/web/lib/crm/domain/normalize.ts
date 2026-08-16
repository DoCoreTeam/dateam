/**
 * 입력 정규화 (통합기획서 v0.2.1 533·534행)
 *
 *   533: (workspace_id, lower(domain)) 부분 유니크
 *   534: (workspace_id, lower(email)) 부분 유니크
 *
 * DB 가 lower() 인덱스로 유일성을 지키지만(마이그 201), 저장값 자체도 정규화한다.
 * 안 하면 화면에 `Data-Alliance.com` 과 `data-alliance.com` 이 섞여 보이고,
 * 사용자는 같은 회사가 왜 두 표기로 나오는지 알 수 없다.
 *
 * ⚠️ 정규화는 **저장 직전 한 곳**에서만 한다. 화면·API 가 각자 하면 언젠가 한 곳이 빠진다.
 */

/**
 * 도메인 정규화: 사용자는 URL 을 통째로 붙여 넣는다.
 *   "https://www.Data-Alliance.com/about?x=1" → "data-alliance.com"
 * 판정할 수 없으면 null — 쓰레기를 도메인으로 저장하지 않는다.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null

  // 스킴이 없어도 파싱되게 붙여 준다(사용자는 보통 안 적는다)
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  let host: string
  try {
    host = new URL(withScheme).hostname
  } catch {
    return null
  }

  const cleaned = host.toLowerCase().replace(/^www\./, '')
  // 점이 없으면 도메인이 아니다("사내망" 같은 입력 방어)
  if (!cleaned.includes('.')) return null
  return cleaned
}

/**
 * 이메일 정규화: 소문자 + 공백 제거.
 * 형식이 아니면 null — DB 에 넣기 전에 걸러 낸다.
 */
export function normalizeEmail(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim().toLowerCase()
  if (!raw) return null
  // 최소 검증만 한다. 완벽한 이메일 정규식은 존재하지 않고, 과하면 정상 주소를 막는다.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return null
  return raw
}

/** 전화: 표시용 구분자를 지우고 숫자·+ 만 남긴다. 국가별 형식은 강제하지 않는다. */
export function normalizePhone(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  const cleaned = raw.replace(/[^\d+]/g, '')
  return cleaned.length >= 7 ? cleaned : null
}

/** 이름·제목 등 자유 텍스트: 앞뒤 공백과 연속 공백만 정리한다(내용은 손대지 않는다) */
export function normalizeText(input: string | null | undefined): string | null {
  const cleaned = (input ?? '').trim().replace(/\s+/g, ' ')
  return cleaned || null
}

/** 필수 텍스트 — 비어 있으면 저장을 막아야 하므로 빈 문자열이 아니라 실패를 알린다 */
export function requireText(input: string | null | undefined): string | null {
  return normalizeText(input)
}
