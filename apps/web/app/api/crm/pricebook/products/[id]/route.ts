// GET    /api/crm/pricebook/products/[id] — 제품 상세 (품목, 규칙)
// PATCH  /api/crm/pricebook/products/[id] — 기본 정보 고치기 (관리자, version 필수)
// DELETE /api/crm/pricebook/products/[id] — 휴지통으로 (관리자). 품목은 지난 견적이 가리키므로 남는다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { getPriceProduct, updatePriceProduct, deletePriceProduct, type ProductInput } from '@/lib/crm/services/pricebook'
import { jsonSafe } from '@/lib/crm/services/json-safe'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => jsonSafe(await getPriceProduct(db, (await params).id)))
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    await updatePriceProduct(session.workspaceId, session.memberId, (await params).id, requireVersion(body), body as ProductInput)
    return { ok: true }
  })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    await deletePriceProduct(session.workspaceId, session.memberId, (await params).id)
    return { ok: true }
  })
}
