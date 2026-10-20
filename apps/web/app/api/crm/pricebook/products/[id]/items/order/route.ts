// PUT /api/crm/pricebook/products/[id]/items/order — 품목 순서와 묶음을 한 번에 (관리자)
// 화면에서 끌어 놓은 결과다. 한 트랜잭션이라 반쯤 옮겨진 순서가 남지 않는다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { parseOrder, saveItemOrder } from '@/lib/crm/services/pricebook-items'

type Ctx = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    await saveItemOrder(session.workspaceId, session.memberId, (await params).id, parseOrder(body.order))
    return { ok: true }
  })
}
