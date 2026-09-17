/**
 * 재직 판정 — SSOT (마이그레이션 255 `member_employment`)
 *
 * **왜 부품이 갖는가**: 「퇴사했나」를 화면마다 `row?.resigned_on != null` 로 적으면, 기록이
 * 아예 없는 사람(= 아직 아무도 안 적었다)을 어떤 화면은 재직으로, 어떤 화면은 알 수 없음으로
 * 읽는다. 판정은 한 곳에서만 한다 — **기록이 없으면 재직이다.**
 *
 * 날짜 검사도 여기 있다. 표에 check 제약이 있지만 사용자는 저장을 눌러 보고서야 그걸 안다.
 * 같은 규칙을 화면이 먼저 말해 줘야 한다.
 */

import type { MemberEmployment } from '@/types/database'

/** 화면·서버가 주고받는 최소 모양 — 전체 행을 안 읽는 자리(뷰)도 이 모양을 만족한다 */
export interface EmploymentRow {
  user_id: string
  hired_on?: string | null
  resigned_on: string | null
}

export type EmploymentMap = Map<string, EmploymentRow>

/** 행 배열을 user_id 로 찾을 수 있게 바꾼다 */
export function employmentMap(rows: readonly EmploymentRow[] | null | undefined): EmploymentMap {
  return new Map((rows ?? []).map((r) => [r.user_id, r]))
}

/**
 * 퇴사했나. **기록이 없으면 재직이다** — 지금 전원의 입사 기록이 없는 상태에서 시작하므로,
 * 없음을 퇴사로 읽으면 첫 배포에 전원이 퇴사자가 된다.
 */
export function isResigned(row: EmploymentRow | null | undefined): boolean {
  return Boolean(row?.resigned_on)
}

export function employmentStatus(row: EmploymentRow | null | undefined): 'active' | 'resigned' {
  return isResigned(row) ? 'resigned' : 'active'
}

/** 퇴사한 사람의 id 묶음 — 사람 고르는 자리가 이걸로 거른다 */
export function resignedIds(rows: readonly EmploymentRow[] | null | undefined): Set<string> {
  return new Set((rows ?? []).filter((r) => r.resigned_on).map((r) => r.user_id))
}

/**
 * 사람 고르는 자리에서 퇴사자를 뺀다.
 *
 * 왜 배열을 받아 배열을 주나: 부르는 자리마다 profiles 를 읽는 방식(관리자 클라이언트·RLS
 * 클라이언트·조인)이 달라서 질의를 하나로 묶을 수 없다. 읽은 뒤 거르는 것은 어디서나 같다.
 */
export function excludeResigned<T extends { id: string }>(
  people: readonly T[],
  resigned: ReadonlySet<string>,
): T[] {
  return people.filter((p) => !resigned.has(p.id))
}

export interface EmploymentDraft {
  hired_on: string | null
  resigned_on: string | null
}

/**
 * 저장 전에 화면이 부르는 검사. 통과면 null, 아니면 사용자가 읽을 한 문장.
 * 표의 check 제약(`resigned_on >= hired_on`)과 같은 규칙이다 — 어느 쪽도 혼자 두지 않는다.
 */
export function validateEmployment(draft: EmploymentDraft): string | null {
  const { hired_on, resigned_on } = draft
  if (hired_on && !isIsoDate(hired_on)) return '입사일 형식이 올바르지 않습니다'
  if (resigned_on && !isIsoDate(resigned_on)) return '퇴사일 형식이 올바르지 않습니다'
  if (hired_on && resigned_on && resigned_on < hired_on) return '퇴사일이 입사일보다 앞설 수 없습니다'
  return null
}

function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** 빈 문자열은 null 로 — 폼이 주는 '' 가 날짜 칸에 그대로 들어가면 표가 거부한다 */
export function toDateOrNull(v: FormDataEntryValue | string | null | undefined): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? null : s
}

/** 재직 기간 표시용 — 둘 다 모르면 null 이라 화면이 줄을 통째로 접을 수 있다 */
export function employmentPeriod(row: Pick<MemberEmployment, 'hired_on' | 'resigned_on'> | null | undefined): string | null {
  if (!row?.hired_on && !row?.resigned_on) return null
  const from = row?.hired_on ?? '?'
  const to = row?.resigned_on ?? '재직 중'
  return `${from} ~ ${to}`
}
