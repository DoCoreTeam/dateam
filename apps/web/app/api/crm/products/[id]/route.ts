// PATCH  /api/crm/products/[id] — 품목 고치기
// DELETE /api/crm/products/[id] — 그만 팔기(소프트). 되돌리려면 PATCH { isActive: true }
//
// **왜 DELETE 가 «그만 팔기»인가**: 지난 견적서가 이 품목을 가리킨다.
// 행을 지우면 그 연결이 끊겨 「어느 품목이었나」를 알 수 없게 된다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import {
  updateProduct, archiveProduct, toProductJson,
  type UpdateProductInput,
} from '@/lib/crm/services/product'

type Ctx = { params: { id: string } }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const row = await updateProduct(
      session.workspaceId, session.memberId, params.id,
      body as unknown as UpdateProductInput,
    )
    return toProductJson(row)
  })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const row = await archiveProduct(session.workspaceId, session.memberId, params.id, false)
    return toProductJson(row)
  })
}
