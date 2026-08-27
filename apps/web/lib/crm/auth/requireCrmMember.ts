/**
 * CRM 접근 판정 (구현명세서 5장 권한 열, TASKS T1-01 "권한 없는 사용자 차단")
 *
 * 판정 순서가 곧 방어선이다. 하나라도 순서를 바꾸면 구멍이 생긴다.
 *   1) 로그인 — 미들웨어가 이미 보장하지만, 여기서도 확인한다(라우트가 직접 서는 경우 대비)
 *   2) api_user 차단 — 외부 API 소비자는 내부 화면에 들어올 수 없다(호스트 규칙)
 *   3) 삭제된 계정 차단 — ⚠️ getRequestProfile 은 일부러 deleted_at 필터를 걸지 않는다.
 *      행을 그대로 돌려주고 판단을 호출부에 맡긴다(그 파일 헤더 참조).
 *      호스트에서 이 게이트를 가진 셸은 admin 하나뿐이라, (ci) 를 베끼면 그대로 빠진다.
 *      CRM 은 영업 데이터라 더더욱 필요하다.
 *   4) CRM 멤버십 — 워크스페이스 멤버가 아니면 CRM 자체를 못 본다
 *
 * 역할은 호스트의 admin/member 가 아니라 **CrmMember.role** 이다(모듈 멤버십 기준).
 * 앱 전역 admin 으로 게이트를 걸면 나중에 "영업팀만" 같은 확장이 막힌다.
 */

import { getRequestUser } from '@/lib/supabase/server'
import { getRequestProfile } from '@/lib/auth/request-profile'
import { getCrmDb } from '@/lib/crm/db/client'
import { resolveCrmWorkspaceId } from '@/lib/crm/workspace'

export type CrmRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'READONLY'

export interface CrmSession {
  /** 호스트 사용자 id (profiles.id) */
  hostUserId: string
  /** CrmMember.id — 감사 로그의 actorId 가 된다 */
  memberId: string
  workspaceId: string
  role: CrmRole
  displayName: string
}

/** 왜 못 들어왔는지 — 화면이 사용자에게 설명할 수 있게 사유를 구분한다 */
export type CrmDenyReason = 'no_session' | 'api_user' | 'deleted_account' | 'not_a_member'

export type CrmAccess =
  | { ok: true; session: CrmSession }
  | { ok: false; reason: CrmDenyReason }

/** 역할 서열 — 높을수록 많이 할 수 있다 */
const RANK: Record<CrmRole, number> = { READONLY: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 }

/** required 이상의 권한을 가졌는가 (명세 5장: READONLY < MEMBER < ADMIN) */
export function hasCrmRole(role: CrmRole, required: CrmRole): boolean {
  return RANK[role] >= RANK[required]
}

/**
 * 지금 요청이 CRM 에 들어올 수 있는지 판정한다.
 * 리다이렉트하지 않는다 — 어디로 보낼지는 화면(레이아웃)이 정한다.
 */
export async function resolveCrmAccess(): Promise<CrmAccess> {
  const user = await getRequestUser()
  if (!user) return { ok: false, reason: 'no_session' }

  const profile = await getRequestProfile()
  if (profile?.role === 'api_user') return { ok: false, reason: 'api_user' }
  if (profile?.deleted_at) return { ok: false, reason: 'deleted_account' }

  return resolveCrmAccessForUser(user.id)
}

/**
 * 쿠키 없이 **사용자 id 만으로** 같은 판정을 한다 — 공개 API(키 인증)가 쓴다.
 *
 * 위 `resolveCrmAccess()` 와 몸통이 하나여야 한다. 두 벌이 되면 언젠가 한쪽만 조여지고
 * 느슨한 쪽이 문이 된다 — 그래서 쿠키 경로도 여기로 위임한다.
 *
 * 호출 전에 **계정 상태(삭제·역할)를 먼저 확인**하는 것은 호출부의 몫이다.
 * 쿠키 경로는 `getRequestProfile()` 로, 키 경로는 `authenticatePublicApi()` 가 이미 본다.
 */
export async function resolveCrmAccessForUser(hostUserId: string): Promise<CrmAccess> {
  const workspaceId = resolveCrmWorkspaceId()
  const db = getCrmDb(workspaceId)

  // 소프트 삭제된 멤버는 가드가 자동으로 걸러 낸다(deletedAt: null 주입).
  // 즉 "내보낸 멤버"는 다시 초대하기 전까지 들어올 수 없다.
  const member = await db.crmMember.findFirst({
    where: { hostUserId },
    select: { id: true, role: true, displayName: true },
  })
  if (!member) return { ok: false, reason: 'not_a_member' }

  return {
    ok: true,
    session: {
      hostUserId,
      memberId: member.id,
      workspaceId,
      role: member.role as CrmRole,
      displayName: member.displayName,
    },
  }
}

/** 사용자에게 보여 줄 문장 — 왜 못 들어오는지 알려 준다(조용히 튕기지 않는다) */
export const CRM_DENY_MESSAGE: Record<CrmDenyReason, string> = {
  no_session: '로그인이 필요합니다.',
  api_user: 'API 전용 계정은 내부 화면을 이용할 수 없습니다.',
  deleted_account: '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
  not_a_member: '영업 CRM 사용 권한이 없습니다. 관리자에게 요청해 주세요.',
}
