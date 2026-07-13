// 대화 검색 sanitize SSOT (세션 2)
// 설계: session-2-multimodal-completeness.md §5-3.

// trim → 길이 2~100자 검증 → ilike 메타문자 이스케이프(% _ \) → 반환.
//  - 2자 미만: null (검색 미실행)
//  - 100자 초과: null  ← 고정 동작(절단 아님). 검색어 과다 입력은 사용자 정정 유도.
//  - 이스케이프: 백슬래시 자신 포함 % _ \ 를 앞에 \ 를 붙여 리터럴화(ilike 와일드카드 무력화).
//    단일 패스 치환이라 이중 이스케이프가 발생하지 않는다.
export function sanitizeSearchQuery(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length < 2 || trimmed.length > 100) return null
  return trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)
}
