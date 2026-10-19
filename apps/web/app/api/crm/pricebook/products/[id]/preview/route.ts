// POST /api/crm/pricebook/products/[id]/preview — 미리 계산
// 견적과 같은 엔진, 같은 제품 모양으로 센다. 고치지 않으므로 읽기 권한이면 된다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { previewPriceProduct } from '@/lib/crm/services/pricebook'
import { parseConditions } from '@/lib/crm/services/pricebook-input'
import { jsonSafe } from '@/lib/crm/services/json-safe'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => {
    const body = await readJson(req)
    return jsonSafe(await previewPriceProduct(db, (await params).id, parseConditions(body.conditions)))
  })
}
