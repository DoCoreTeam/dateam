// 가격 기준 버전 (마이그 317, REQ-012)
//
// 새 가격표를 같은 제품에 올리면 그 제품의 버전이 하나 오르고 적용일이 남는다.
// 새 제품이면 1 이다. 적용일을 안 주면 오늘(KST)이다.

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** 적용일 문자열 → 그날 0시(UTC 날짜 칸). 형식이 틀리거나 없는 날이면 null */
export function parseEffectiveDay(v: unknown): Date | null {
  if (typeof v !== 'string' || !DAY.test(v)) return null
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d
}

/** 저장할 버전 — 새 제품이면 1, 있던 제품이면 하나 올린다 */
export function nextRevision(existing: { revision?: number | null } | null): number {
  if (!existing) return 1
  return Math.max(1, Math.trunc(Number(existing.revision ?? 1))) + 1
}
