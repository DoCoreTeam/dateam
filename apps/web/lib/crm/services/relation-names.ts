/**
 * 붙어 있는 것의 **이름**을 한 번에 붙인다 (SSOT)
 *
 * **왜 이게 따로 있나**: 목록 행이 `companyId` 만 들고 있으면 화면은 id 를 그릴 수도,
 * 이름을 그릴 수도 없다 — 사용자는 **「이게 어느 건이지?」를 알려고 매번 눌러 봐야 한다**
 * (사용자 지적: 「이거 너는 어떤 딜인지 알겠니? 왜 친절하지가 않아?」).
 *
 * 미팅 목록은 이 처리를 갖고 있었고 할 일 목록은 없었다 — **같은 성격의 자리인데
 * 한 곳만 고쳐진 상태**였다. 두 번째 사용처가 생겼으므로 공용으로 올린다.
 *
 * **왕복은 종류당 한 번이다.** 행마다 부르면 100줄짜리 목록이 조회 300번이 된다.
 */

import type { CrmDb } from '../db/client.ts'

/** 이름을 붙일 수 있는 종류 — 늘리려면 여기 한 곳만 본다 */
export interface RelationNames {
  companyName: string | null
  dealName: string | null
  personName: string | null
}

interface HasRelationIds {
  companyId?: string | null
  dealId?: string | null
  personId?: string | null
}

/**
 * 행 배열에 `companyName`·`dealName`·`personName` 을 붙여 돌려준다.
 *
 * 지워진 것(소프트 삭제)은 이름이 `null` 로 남는다 — 그게 사실이다.
 * 「(삭제됨)」 같은 말을 여기서 지어내지 않는다: 화면마다 다르게 말하고 싶을 수 있고,
 * 무엇보다 **없는 것과 못 읽은 것을 구분**할 수 있어야 한다.
 */
export async function attachRelationNames<T extends HasRelationIds>(
  db: CrmDb,
  rows: readonly T[],
): Promise<(T & RelationNames)[]> {
  const pick = (key: 'companyId' | 'dealId' | 'personId'): string[] =>
    Array.from(new Set(rows.map((r) => r[key]).filter((v): v is string => Boolean(v))))

  const companyIds = pick('companyId')
  const dealIds = pick('dealId')
  const personIds = pick('personId')

  const [companies, deals, people] = await Promise.all([
    companyIds.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (db as any).crmCompany.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    dealIds.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (db as any).crmDeal.findMany({ where: { id: { in: dealIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    personIds.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (db as any).crmPerson.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]) as [{ id: string; name: string }[], { id: string; name: string }[], { id: string; name: string }[]]

  const cMap = new Map(companies.map((x) => [x.id, x.name]))
  const dMap = new Map(deals.map((x) => [x.id, x.name]))
  const pMap = new Map(people.map((x) => [x.id, x.name]))

  return rows.map((r) => ({
    ...r,
    companyName: r.companyId ? cMap.get(r.companyId) ?? null : null,
    dealName: r.dealId ? dMap.get(r.dealId) ?? null : null,
    personName: r.personId ? pMap.get(r.personId) ?? null : null,
  }))
}
