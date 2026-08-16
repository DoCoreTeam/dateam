/**
 * 이름으로 회사·사람 찾기 — 일일업무와 CRM 이 함께 쓰는 SSOT (dacrm 정정판)
 *
 * **왜 이 파일이 생겼나**: 일일업무 AI 가 "삼성SDS 미팅 다녀옴"을 읽고 거래처를 찾을 때
 * `a.name === item.accountName` — **정확 문자열 일치**를 쓰고 있었다.
 * 그래서 `Konsttech` 라고 적으면 `konst tech` 를 못 찾고, `㈜` 하나 붙으면 남이 된다.
 * 사람은 매번 다르게 적는데 코드가 완전 일치를 요구하니, 연결은 대부분 실패한다.
 *
 * 게다가 **CRM 회사는 아예 안 본다.** 영업 CRM 에 회사를 넣어 두고 일일업무에
 * 그 회사 이름을 적어도, 두 기록은 영원히 만나지 않는다.
 *
 * 이 파일이 그 둘을 한 번에 고친다 —
 *   ① 표기 흔들림을 흡수한다(㈜·주식회사·Inc·공백·대소문자)
 *   ② 구 CRM(accounts)과 새 CRM(crm_company)을 **함께** 후보로 본다
 *
 * **애매하면 연결하지 않는다.** 틀린 회사에 붙은 기록은 지워도
 * "그 회사와 그런 일이 있었다"는 기억을 남긴다. 못 찾는 것보다 나쁘다.
 */

/**
 * 비교용 키.
 *
 * `lib/crm/services/merge.ts` 의 회사명 정규화와 **같은 규칙**이어야 한다 —
 * 병합이 "같다"고 본 두 이름을 연결이 "다르다"고 보면 사용자는 둘 중 뭘 믿을지 모른다.
 */
export function nameKey(name: string | null | undefined): string | null {
  if (!name) return null
  const t = name.trim()
  if (!t) return null
  const key = t
    .toLowerCase()
    .replace(/주식회사|㈜|\(주\)|inc\.?|corp\.?|ltd\.?|llc|co\.?/g, '')
    .replace(/[()（）\s,.·\-_]/g, '')
  return key || null
}

export interface Candidate {
  id: string
  name: string
  /** 어느 쪽 시스템에서 왔나 — 화면이 "영업 CRM 의 회사"라고 말할 수 있어야 한다 */
  source: 'crm' | 'legacy'
}

export interface MatchResult {
  /** 확실히 하나로 좁혀졌을 때만 채워진다 */
  matched: Candidate | null
  /** 여럿이 걸렸을 때 — 사람이 고르게 한다. 우리가 고르면 틀린 회사에 붙는다 */
  ambiguous: Candidate[]
}

/**
 * 이름 하나로 후보를 찾는다.
 *
 * 새 CRM 을 먼저 본다 — 둘 다 있으면 CRM 이 정본이다(구 CRM 은 이관 대상).
 * 그래야 이관이 진행될수록 연결이 자연스럽게 새 쪽으로 옮겨 간다.
 */
export function matchByName(name: string | null | undefined, candidates: Candidate[]): MatchResult {
  const key = nameKey(name)
  if (!key) return { matched: null, ambiguous: [] }

  const hits = candidates.filter((c) => nameKey(c.name) === key)
  if (hits.length === 0) return { matched: null, ambiguous: [] }

  const crm = hits.filter((h) => h.source === 'crm')
  // CRM 에 정확히 하나면 그것 — 구 CRM 에 같은 이름이 있어도 CRM 이 정본이다
  if (crm.length === 1) return { matched: crm[0], ambiguous: [] }
  // CRM 에 없고 구 CRM 에 하나면 그것
  if (crm.length === 0 && hits.length === 1) return { matched: hits[0], ambiguous: [] }

  // 여럿이면 고르지 않는다 — 틀린 회사에 붙는 것보다 안 붙는 편이 낫다
  return { matched: null, ambiguous: crm.length > 0 ? crm : hits }
}

/**
 * AI 프롬프트에 넣을 후보 목록을 만든다.
 *
 * 이름만 준다 — id 를 프롬프트에 넣으면 모델이 그럴듯한 id 를 지어낸다(환각).
 * id 는 우리가 이름으로 되찾는다.
 */
export function promptNames(candidates: Candidate[], limit = 200): string {
  const seen = new Set<string>()
  const names: string[] = []
  for (const c of candidates) {
    const key = nameKey(c.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    names.push(c.name)
    if (names.length >= limit) break
  }
  return names.length > 0 ? names.join(', ') : '없음'
}
