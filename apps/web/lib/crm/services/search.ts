// CRM 안에서 찾기 (dacrm)
//
// **왜 필요한가**: 셸의 전역 검색창은 `/work/search` 로 간다 — 호스트 업무 검색이다.
// 그래서 CRM 안에서 "삼성"을 치면 **CRM 을 떠나** 업무 문서 결과가 나왔고,
// 정작 삼성SDS 회사·딜·인물은 어디에도 없었다.
//
// 사람은 지금 보고 있는 것 안에서 찾는다고 기대한다.
// CRM 안에 있으면 CRM 을 찾아야 한다.
//
// **한 번에 한 종류만 찾지 않는다.** "삼성"이 회사인지 딜인지 인물인지는
// 찾는 사람도 모른다 — 그래서 세 가지를 함께 보여 주고 종류를 밝힌다.

import type { CrmDb } from '../db/client.ts'
import { normalizeText } from '../domain/normalize.ts'
import { sanitizeSearchQuery } from '../../ai-chat/search.ts'

export type SearchKind = 'company' | 'person' | 'deal' | 'meeting'

export interface SearchHit {
  kind: SearchKind
  id: string
  title: string
  /** 무엇으로 찾았는지 알 수 있는 한 줄 — 같은 이름이 여러 개일 때 구분한다 */
  sub: string | null
  href: string
}

export interface SearchResult {
  q: string
  hits: SearchHit[]
  /** 종류별 개수 — 어디에 많은지 먼저 보인다 */
  counts: Record<SearchKind, number>
  /** 상한에 걸려 잘렸나 — 조용히 자르면 "없다"로 읽힌다 */
  truncated: boolean
}

/** 종류마다 이만큼씩 — 한 종류가 화면을 다 먹지 않게 */
const PER_KIND = 8

const EMPTY_COUNTS: Record<SearchKind, number> = { company: 0, person: 0, deal: 0, meeting: 0 }

export async function searchCrm(db: CrmDb, rawQuery: string): Promise<SearchResult> {
  const q = normalizeText(rawQuery) ?? ''

  /**
   * LIKE 메타문자를 막는다.
   *
   * `%` 는 LIKE 에서 "아무거나"다 — 그냥 넘기면 사용자가 `%` 한 글자로
   * **전체 목록을 덤프**할 수 있다(실측: `%_` 로 10건). 검색이 아니라 유출 경로다.
   * 호스트에 이미 같은 사고를 막는 SSOT 가 있어 그대로 쓴다(두 벌을 만들지 않는다).
   *
   * 한 글자로 찾으면 거의 전부가 걸린다 — 그것도 여기서 함께 막힌다(2자 미만 null).
   */
  const safe = sanitizeSearchQuery(q)
  if (!safe) {
    return { q, hits: [], counts: { ...EMPTY_COUNTS }, truncated: false }
  }

  const like = { contains: safe, mode: 'insensitive' as const }

  const [companies, people, deals, meetings] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).crmCompany.findMany({
      where: { OR: [{ name: like }, { domain: like }] },
      select: { id: true, name: true, domain: true, industry: true },
      take: PER_KIND + 1, orderBy: { updatedAt: 'desc' },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).crmPerson.findMany({
      where: { OR: [{ name: like }, { email: like }, { title: like }] },
      select: { id: true, name: true, email: true, title: true },
      take: PER_KIND + 1, orderBy: { updatedAt: 'desc' },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).crmDeal.findMany({
      where: { name: like },
      select: { id: true, name: true, status: true },
      take: PER_KIND + 1, orderBy: { updatedAt: 'desc' },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).crmMeeting.findMany({
      where: { OR: [{ title: like }, { location: like }] },
      select: { id: true, title: true, startedAt: true },
      take: PER_KIND + 1, orderBy: { startedAt: 'desc' },
    }),
  ]) as [
    { id: string; name: string; domain: string | null; industry: string | null }[],
    { id: string; name: string; email: string | null; title: string | null }[],
    { id: string; name: string; status: string }[],
    { id: string; title: string; startedAt: Date }[],
  ]

  const truncated =
    companies.length > PER_KIND || people.length > PER_KIND ||
    deals.length > PER_KIND || meetings.length > PER_KIND

  const hits: SearchHit[] = [
    ...companies.slice(0, PER_KIND).map((c) => ({
      kind: 'company' as const, id: c.id, title: c.name,
      sub: c.domain ?? c.industry ?? null, href: `/crm/companies/${c.id}`,
    })),
    ...people.slice(0, PER_KIND).map((p) => ({
      kind: 'person' as const, id: p.id, title: p.name,
      sub: [p.title, p.email].filter(Boolean).join(' · ') || null, href: `/crm/people/${p.id}`,
    })),
    ...deals.slice(0, PER_KIND).map((d) => ({
      kind: 'deal' as const, id: d.id, title: d.name,
      // 끝난 딜인지 알려 준다 — 성사된 딜을 진행 중으로 오해하면 두 번 판다
      sub: d.status === 'OPEN' ? null : (d.status === 'WON' ? '성사됨' : '실패'),
      href: `/crm/deals/${d.id}`,
    })),
    ...meetings.slice(0, PER_KIND).map((m) => ({
      kind: 'meeting' as const, id: m.id, title: m.title,
      sub: null, href: `/crm/meetings/${m.id}`,
    })),
  ]

  return {
    q,
    hits,
    counts: {
      company: Math.min(companies.length, PER_KIND),
      person: Math.min(people.length, PER_KIND),
      deal: Math.min(deals.length, PER_KIND),
      meeting: Math.min(meetings.length, PER_KIND),
    },
    truncated,
  }
}

export const KIND_LABEL: Record<SearchKind, string> = {
  company: '회사', person: '인물', deal: '딜', meeting: '미팅',
}
