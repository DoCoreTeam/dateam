/**
 * CRM 후보 불러오기 — 호스트 화면이 CRM 을 볼 수 있게 하는 창구 (dacrm 정정판)
 *
 * 호스트(일일업무·회의노트)는 CRM 의 워크스페이스 개념을 모른다.
 * 그래서 여기서 한 겹 감싸, 호스트는 "회사·사람 이름 목록"만 받게 한다.
 *
 * **실패해도 호출부를 막지 않는다.** 일일업무 분석이 CRM 조회 때문에 죽으면
 * 사용자는 방금 적은 업무를 잃는다. 곁들이는 일이 본 일을 막으면 안 된다 —
 * 이 저장소가 "감사·로깅이 사용자 저장을 막으면 안 된다"고 정한 것과 같은 원칙이다.
 */

import type { Candidate } from './name-match.ts'

export interface CrmCandidates {
  companies: Candidate[]
  people: Candidate[]
}

const EMPTY: CrmCandidates = { companies: [], people: [] }

/**
 * 후보 상한.
 *
 * 프롬프트에 넣을 이름 목록이라 무한정 늘릴 수 없다 —
 * 200개를 넘으면 모델이 목록을 제대로 못 읽고, 토큰만 먹는다.
 */
const LIMIT = 200

/**
 * 참석자를 이을 때 쓰는 후보 — 이름만으로는 못 가리므로 **소속을 함께** 준다.
 *
 * `loadCrmCandidates` 와 나누는 이유: 저쪽은 AI 프롬프트에 넣을 **이름 목록**이라
 * 소속이 필요 없고 상한이 200 이다. 참석자 잇기는 「같은 이름이 여럿일 때 소속으로 좁히는」
 * 일이라 소속이 없으면 판정 자체가 성립하지 않는다(`attendee-link.ts` 의 homonym·company-mismatch).
 */
export interface AttendeeCandidates {
  people: { id: string; name: string; companyId: string | null; companyName: string | null; title: string | null }[]
  companies: { id: string; name: string }[]
}

const EMPTY_ATTENDEE: AttendeeCandidates = { people: [], companies: [] }

/**
 * 이름으로 후보를 좁혀 온다.
 *
 * `q` 를 주면 그것으로 거르고, 없으면 앞에서부터 `LIMIT` 만큼 — 화면이 타이핑에 맞춰 부른다.
 * 여기서도 실패가 호출부를 막지 않는다(`loadCrmCandidates` 와 같은 이유).
 */
export async function loadAttendeeCandidates(q?: string): Promise<AttendeeCandidates> {
  try {
    const { resolveCrmWorkspaceId } = await import('../workspace.ts')
    const { getCrmDb } = await import('../db/client.ts')
    const db = getCrmDb(resolveCrmWorkspaceId())

    const term = (q ?? '').trim()
    const personWhere = term ? { name: { contains: term }, deletedAt: null } : { deletedAt: null }
    const companyWhere = term ? { name: { contains: term }, deletedAt: null } : { deletedAt: null }

    const [people, companies] = await Promise.all([
      db.crmPerson.findMany({
        where: personWhere,
        select: { id: true, name: true, title: true, companyId: true, company: { select: { name: true } } },
        take: LIMIT,
      }),
      db.crmCompany.findMany({ where: companyWhere, select: { id: true, name: true }, take: LIMIT }),
    ])

    return {
      people: (people as { id: string; name: string; title: string | null; companyId: string | null; company: { name: string } | null }[])
        .map((p) => ({
          id: p.id, name: p.name, title: p.title,
          companyId: p.companyId, companyName: p.company?.name ?? null,
        })),
      companies: companies as { id: string; name: string }[],
    }
  } catch (e) {
    console.error('[crm/candidates] 참석자 후보 조회 실패 — 잇기 없이 진행합니다:', e)
    return EMPTY_ATTENDEE
  }
}

/**
 * 이미 이어 둔 인물을 id 로 되찾는다.
 *
 * 저장된 것은 id 뿐이라, 화면을 다시 열 때 이름·소속이 없으면 칩을 그릴 수 없다.
 * 지워진 인물은 빠진 채로 온다 — 그러면 화면에서도 조용히 사라진다(고아 표시를 안 만든다).
 */
export async function loadAttendeePeopleByIds(ids: string[]): Promise<AttendeeCandidates> {
  if (ids.length === 0) return EMPTY_ATTENDEE
  try {
    const { resolveCrmWorkspaceId } = await import('../workspace.ts')
    const { getCrmDb } = await import('../db/client.ts')
    const db = getCrmDb(resolveCrmWorkspaceId())

    const rows = await db.crmPerson.findMany({
      where: { id: { in: ids.slice(0, LIMIT) }, deletedAt: null },
      select: { id: true, name: true, title: true, companyId: true, company: { select: { name: true } } },
    }) as { id: string; name: string; title: string | null; companyId: string | null; company: { name: string } | null }[]

    return {
      people: rows.map((p) => ({
        id: p.id, name: p.name, title: p.title,
        companyId: p.companyId, companyName: p.company?.name ?? null,
      })),
      companies: [],
    }
  } catch (e) {
    console.error('[crm/candidates] 이어 둔 인물 조회 실패:', e)
    return EMPTY_ATTENDEE
  }
}

export async function loadCrmCandidates(): Promise<CrmCandidates> {
  try {
    const { resolveCrmWorkspaceId } = await import('../workspace.ts')
    const { getCrmDb } = await import('../db/client.ts')
    const db = getCrmDb(resolveCrmWorkspaceId())

    const [companies, people] = await Promise.all([
      db.crmCompany.findMany({ select: { id: true, name: true }, take: LIMIT }),
      db.crmPerson.findMany({ select: { id: true, name: true }, take: LIMIT }),
    ])

    return {
      companies: companies.map((c: { id: string; name: string }) => ({ ...c, source: 'crm' as const })),
      people: people.map((p: { id: string; name: string }) => ({ ...p, source: 'crm' as const })),
    }
  } catch (e) {
    // CRM 이 없거나 조회가 실패해도 호스트 기능은 그대로 돌아야 한다
    console.error('[crm/candidates] CRM 후보 조회 실패 — 구 CRM 만으로 진행합니다:', e)
    return EMPTY
  }
}
