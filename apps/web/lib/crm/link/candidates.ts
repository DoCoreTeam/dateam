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
