/**
 * 세션의 능력을 읽는다 — 세션 토큰에 담지 않는 이유가 있다.
 *
 * 능력을 세션에 굽면 관리자가 권한을 준 뒤 **그 사람이 다시 로그인할 때까지** 안 먹는다.
 * 요청마다 읽되 요청 안에서는 한 번만 읽는다(React cache).
 */
import { cache } from 'react'
import type { CrmDb } from '../db/client.ts'
import type { Capability, Viewer } from '../security/sensitivity.ts'
import { CAPABILITIES } from '../../access/capabilities.ts'

/**
 * 아는 권한 이름 — **전사 등록부에서 온다.**
 *
 * 예전엔 역할 기본값(`ROLE_CAPABILITIES`)을 펼쳐 만들었다. 그러면 **어느 역할도 기본으로
 * 안 가진 권한은 개별로 줘도 조용히 버려진다.** 관리자는 준 줄 알고, 받은 사람은 안 되고,
 * 아무 데도 기록이 없다. 「조용한 무시가 제일 나쁘다」가 이 저장소의 판단이다(마이그 277).
 *
 * 지금은 우연히 문제가 안 난다 — 새로 넣은 `owner.reassign` 이 OWNER·ADMIN 기본값에 있어서다.
 * 하지만 「팀장에게만 주는 권한」처럼 기본값 어디에도 없는 것을 만드는 순간 터진다.
 * 그래서 기준을 **이름 목록**으로 바꾼다. 오타를 막는다는 원래 목적은 그대로다.
 */
const KNOWN = new Set<string>(CAPABILITIES)

/** 멤버 행의 개별 부여 능력. 없으면 역할 기본값만 쓴다 */
export const loadCapabilities = cache(async (db: CrmDb, memberId: string): Promise<readonly Capability[]> => {
  const row = await db.crmMember.findFirst({ where: { id: memberId }, select: { capabilities: true } })
  // 모르는 문자열이 DB 에 있어도 권한으로 인정하지 않는다 — 오타가 권한이 되면 안 된다
  return (row?.capabilities ?? []).filter((c): c is Capability => KNOWN.has(c))
})

/** 민감도 판정에 넘길 관람자 */
export async function viewerOf(db: CrmDb, session: { role: string; memberId: string }): Promise<Viewer> {
  return { role: session.role, capabilities: await loadCapabilities(db, session.memberId) }
}
