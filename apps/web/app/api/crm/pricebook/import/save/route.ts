// POST /api/crm/pricebook/import/save — 가져오기 초안을 한 트랜잭션으로 저장 (관리자)
//
// 초안은 화면을 거쳐 돌아오므로 검증 2 3 4 5 를 서버가 다시 돈다. 실패하면 하나도 안 남는다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { savePriceImport } from '@/lib/crm/services/pricebook-import'

export async function POST(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return savePriceImport(session.workspaceId, session.memberId, {
      draft: body.draft,
      sourceText: typeof body.sourceText === 'string' ? body.sourceText.slice(0, 30_000) : '',
      fileName: typeof body.fileName === 'string' ? body.fileName : '',
      productId: typeof body.productId === 'string' && body.productId ? body.productId : null,
      // 이 제품의 빠진 규칙 가운데서만 고른다(서비스가 다시 거른다) — 남의 규칙 id 는 아무것도 못 지운다
      // 형식은 서비스가 다시 본다(YYYY-MM-DD, 없는 날 거절)
      effectiveFrom: typeof body.effectiveFrom === 'string' ? body.effectiveFrom.slice(0, 10) : null,
      dropRuleIds: Array.isArray(body.dropRuleIds) ? body.dropRuleIds.filter((x: unknown): x is string => typeof x === 'string').slice(0, 200) : [],
    })
  })
}
