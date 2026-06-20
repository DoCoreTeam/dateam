// 회의 참석자 이름 → 조직원 매칭 (순수 함수 — Supabase/Gemini 비의존, 테스트 가능)
// SSOT: 이름→조직원 매칭은 이 모듈만. 모든 호출처(AI 후보 분류·AttendeesPanel)가 재사용.
// people = listOrgPeople()(profiles id,name). 외부인은 unmatched로 분리.

// ---- 직급/호칭 접미사(이름 끝에 붙는 1글자) ----
// "홍길동님","김철수씨" → "홍길동","김철수"로 정규화해 비교.
const NAME_SUFFIX_RE = /(님|씨)$/

// 이름 정규화: trim → 연속 공백 1칸 → 소문자 → 끝의 호칭 접미사 제거
export function normalizeName(s: string): string {
  const base = s.trim().replace(/\s+/g, ' ').toLowerCase()
  return base.replace(NAME_SUFFIX_RE, '')
}

export interface MatchedPerson {
  id: string
  name: string
}

export interface MatchAttendeesResult {
  matched: MatchedPerson[]
  unmatched: string[]
}

// names를 정규화 후 people와 정확 일치 비교.
//  - 일치: matched(첫 일치 person), 동일 person 중복 id 제거.
//  - 불일치: unmatched(원본 이름 보존), 중복 제거.
//  - 빈/공백 이름은 스킵.
export function matchAttendees(
  names: string[],
  people: { id: string; name: string }[]
): MatchAttendeesResult {
  // people를 정규화 이름 → person 인덱스(첫 등장 우선 = 동명이인 첫 일치)
  const byNorm = new Map<string, MatchedPerson>()
  for (const p of people) {
    const key = normalizeName(p.name)
    if (!key) continue
    if (!byNorm.has(key)) byNorm.set(key, { id: p.id, name: p.name })
  }

  const matched: MatchedPerson[] = []
  const matchedIds = new Set<string>()
  const unmatched: string[] = []
  const seenUnmatched = new Set<string>()

  for (const raw of names) {
    const key = normalizeName(raw)
    if (!key) continue // 빈/공백 이름 스킵

    const hit = byNorm.get(key)
    if (hit) {
      if (!matchedIds.has(hit.id)) {
        matchedIds.add(hit.id)
        matched.push(hit)
      }
    } else {
      const trimmed = raw.trim()
      if (trimmed && !seenUnmatched.has(key)) {
        seenUnmatched.add(key)
        unmatched.push(trimmed)
      }
    }
  }

  return { matched, unmatched }
}
