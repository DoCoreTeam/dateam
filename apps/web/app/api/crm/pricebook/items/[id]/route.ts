// PATCH /api/crm/pricebook/items/[id] — 품목 고치기 (관리자). 정상가가 바뀌면 가격 이력에 새 줄
// 제품을 옮기려면 priceProductId 를 함께 보낸다. 비우면 제품에 안 묶인 품목이 된다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { saveItem } from '@/lib/crm/services/pricebook'
import { parseItem } from '@/lib/crm/services/pricebook-input'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    const item = parseItem(body)
    const productId = typeof body.priceProductId === 'string' && body.priceProductId ? body.priceProductId : null
    return saveItem(session.workspaceId, session.memberId, productId, { ...item, id: (await params).id }, Number(body.position ?? 0) || 0)
  })
}
