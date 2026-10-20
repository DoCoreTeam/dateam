// POST /api/crm/pricebook/items/[id]/action — 품목 한 건에 판매 중지, 다시 판매, 가격 확인, 묶음 옮기기, 복제 (관리자)
// 여러 개는 화면이 이 한 건 창구를 여러 번 부른다(lib/ui/use-bulk-action) — bulk 창구를 따로 두면 규칙이 두 벌이 된다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { bulkItems, parseBulk } from '@/lib/crm/services/pricebook-items'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return bulkItems(session.workspaceId, session.memberId, parseBulk({ ...body, ids: [(await params).id] }))
  })
}
