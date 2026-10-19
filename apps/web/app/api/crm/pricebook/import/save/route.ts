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
    })
  })
}
