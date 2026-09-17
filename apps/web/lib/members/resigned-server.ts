/**
 * 사람 고르는 목록에서 퇴사자를 뺀다 — 서버 쪽 한 벌
 *
 * **왜 표가 아니라 뷰를 읽나**: `member_employment` 본체는 관리자만 읽는다(사유·메모가 있다).
 * 그런데 사람을 고르는 자리는 대부분 일반 구성원 화면이다 — 본체를 읽으면 RLS 가 0행을 주고,
 * 오류도 안 나면서 **아무도 안 걸러진다.** 조용히 안 도는 거르개가 제일 나쁘다.
 * 그래서 재직 여부만 담은 `v_member_employment_status` 를 읽는다(마이그레이션 255).
 *
 * **못 읽으면 전원을 남긴다**: 거르개가 실패했다고 고르는 목록을 통째로 비우면,
 * 퇴사자 하나를 숨기려다 담당자 지정 자체를 막는다. 덜 거르는 쪽이 덜 해롭다.
 */

import { resignedIds, excludeResigned, type EmploymentRow } from './employment.ts'

// 부르는 자리마다 클라이언트 종류가 달라(관리자·RLS·타입 캐스팅) 좁은 타입을 세울 수 없다
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any

export async function loadResignedIds(db: AnyDb): Promise<Set<string>> {
  const { data, error } = await db
    .from('v_member_employment_status')
    .select('user_id, resigned_on')
    .not('resigned_on', 'is', null)
  if (error) {
    console.warn('[resigned-server] 재직 기록을 못 읽어 전원을 남긴다:', error.message)
    return new Set()
  }
  return resignedIds((data ?? []) as EmploymentRow[])
}

/** 고르는 목록에서 퇴사자를 뺀 것 */
export async function activeMembers<T extends { id: string }>(db: AnyDb, people: readonly T[] | null | undefined): Promise<T[]> {
  const list = people ?? []
  if (list.length === 0) return []
  return excludeResigned(list, await loadResignedIds(db))
}
