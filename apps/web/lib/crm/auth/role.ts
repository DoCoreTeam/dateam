/**
 * CRM 역할과 서열 — 의존성 없는 판정만 (P0132 I10 에서 requireCrmMember.ts 에서 옮김)
 *
 * 세션을 읽는 모듈은 Supabase 연결을 끌고 와 시험 실행기가 못 읽는다.
 * 판정은 여기 한 곳에 두고 requireCrmMember.ts 가 같은 것을 다시 내보낸다.
 */

export type CrmRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'READONLY'

/** 역할 서열 — 높을수록 많이 할 수 있다 */
const RANK: Record<CrmRole, number> = { READONLY: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 }

/** required 이상의 권한을 가졌는가 (명세 5장: READONLY < MEMBER < ADMIN) */
export function hasCrmRole(role: CrmRole, required: CrmRole): boolean {
  return RANK[role] >= RANK[required]
}
