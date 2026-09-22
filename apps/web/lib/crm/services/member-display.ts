/**
 * 멤버 한 명을 화면에 그릴 값 — **한 번 읽어 여러 자리가 나눠 쓴다**
 *
 * 담당자·작성자·참석자가 나오는 자리마다 멤버 표를 따로 읽으면 요청 하나에 같은 표를
 * 몇 번씩 읽고, 더 나쁘게는 **자리마다 다른 값을 그린다** — 어떤 곳은 이름만, 어떤 곳은 직함까지.
 *
 * 직급·직책은 `profiles` 에 있다. 그것까지 여기서 붙여 준다.
 * 조회는 **이미 멤버인 사람의 id 로만** 한다 — 조건 없이 훑으면 「그 사람이 있느냐」를
 * 대답하는 자리가 된다.
 */

import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '../../supabase/server.ts'
import type { CrmDb } from '../db/client.ts'
import type { PersonSource } from '../../ui/person.ts'

export interface MemberDisplay extends PersonSource {
  memberId: string
  /** 아직 이 CRM 의 멤버인가. 나간 사람이면 담당자 판정이 조직 상위로 올라간다 */
  active: boolean
  hostUserId: string
}

/**
 * 나간 사람까지 **전부** 읽는다.
 *
 * 나간 사람을 빼면 「이전 담당자」가 이름 없이 id 로 뜬다. 지나간 기록에는 그 사람 이름이
 * 그대로 남아야 하고(작성자는 과거 사실이다), 나갔다는 사실은 `active` 로 말한다.
 */
export const loadMemberDisplays = cache(async (db: CrmDb): Promise<Map<string, MemberDisplay>> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmMember.findMany({
    select: { id: true, displayName: true, title: true, hostUserId: true, deletedAt: true },
  }) as { id: string; displayName: string; title: string | null; hostUserId: string; deletedAt: Date | null }[]

  const titles = new Map<string, { rank: string | null; position: string | null }>()
  try {
    const ids = rows.map((r) => r.hostUserId).filter(Boolean)
    if (ids.length) {
      const sb = createAdminClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (sb.from('profiles') as any)
        .select('id, rank, position')
        .in('id', ids) as { data: { id: string; rank: string | null; position: string | null }[] | null }
      for (const p of data ?? []) titles.set(p.id, { rank: p.rank, position: p.position })
    }
  } catch {
    // 직함을 못 읽어도 이름은 나온다 — 화면이 멈출 값이 아니다
  }

  return new Map(rows.map((r) => [r.id, {
    memberId: r.id,
    name: r.displayName,
    explicitTitle: r.title,
    position: titles.get(r.hostUserId)?.position ?? null,
    rank: titles.get(r.hostUserId)?.rank ?? null,
    active: r.deletedAt === null,
    hostUserId: r.hostUserId,
  }]))
})

/** 화면에 내보낼 모양. 값이 없으면 null 이고 화면이 「기록 없음」으로 그린다 */
export interface PersonJson {
  memberId: string
  name: string
  position: string | null
  rank: string | null
  explicitTitle: string | null
  active: boolean
}

export function toPersonJson(
  memberId: string | null | undefined,
  map: Map<string, MemberDisplay>,
): PersonJson | null {
  if (!memberId) return null
  const m = map.get(memberId)
  if (!m) return null
  return {
    memberId: m.memberId,
    name: m.name ?? '',
    position: m.position ?? null,
    rank: m.rank ?? null,
    explicitTitle: m.explicitTitle ?? null,
    active: m.active,
  }
}
