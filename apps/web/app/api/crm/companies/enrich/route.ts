// POST /api/crm/companies/enrich — 고른 회사 여러 곳을 웹에서 찾아 빈 칸을 채운다
//
// 정적 세그먼트라 /api/crm/companies/[id] 보다 먼저 잡힌다("enrich" 라는 id 는 없다).
//
// 한 건이 실패해도 나머지는 계속한다. 무엇이 됐고 무엇이 안 됐는지를 응답으로 돌려주므로,
// 화면은 "N곳 채웠고 M곳은 이래서 못 했어요"라고 말할 수 있다 — 조용히 삼키지 않는다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { adapterFromSetting } from '@/lib/crm/services/quick-create'
import { enrichCompaniesFromWeb } from '@/lib/crm/services/enrich-web'

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const body = await readJson(req)
    const raw = body.companyIds
    if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
      throw new CrmError('VALIDATION_FAILED', '보강할 회사를 골라 주세요.')
    }
    // 중복을 걸러 낸다 — 같은 회사를 두 번 고르면 웹 검색이 두 번 나가고 두 번 결제된다
    const companyIds = Array.from(new Set(raw as string[]))

    // 웹 검색을 못 하는 프로바이더면 어댑터가 여기서 분명히 실패한다 —
    // 기억으로 답한 값을 "찾았다"고 보여 주지 않기 위해서다(host.ts).
    const adapter = await adapterFromSetting(db, { webSearch: true })
    return enrichCompaniesFromWeb(db, session.workspaceId, session.memberId, companyIds, adapter)
  })
}
