/**
 * 세션의 능력을 읽는다 — 세션 토큰에 담지 않는 이유가 있다.
 *
 * 능력을 세션에 굽면 관리자가 권한을 준 뒤 **그 사람이 다시 로그인할 때까지** 안 먹는다.
 * 요청마다 읽되 요청 안에서는 한 번만 읽는다(React cache).
 */
import { cache } from 'react'
import type { CrmDb } from '../db/client.ts'
import { ROLE_CAPABILITIES, type Capability, type Viewer } from '../security/sensitivity.ts'

/** 멤버 행의 개별 부여 능력. 없으면 역할 기본값만 쓴다 */
export const loadCapabilities = cache(async (db: CrmDb, memberId: string): Promise<readonly Capability[]> => {
  const row = await db.crmMember.findFirst({ where: { id: memberId }, select: { capabilities: true } })
  const all = new Set<string>(Object.values(ROLE_CAPABILITIES).flat())
  // 모르는 문자열이 DB 에 있어도 권한으로 인정하지 않는다 — 오타가 권한이 되면 안 된다
  return (row?.capabilities ?? []).filter((c): c is Capability => all.has(c))
})

/** 민감도 판정에 넘길 관람자 */
export async function viewerOf(db: CrmDb, session: { role: string; memberId: string }): Promise<Viewer> {
  return { role: session.role, capabilities: await loadCapabilities(db, session.memberId) }
}
