// GET /api/crm/pricebook/items/[id]/history — 품목 정상가의 흐름 (?target=LABOR_GRADE 면 등급)
// 등급 원가 줄은 cost.view 가 있을 때만 싣는다
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { listPriceHistory } from '@/lib/crm/services/pricebook-history'
import { viewerOf } from '@/lib/crm/auth/capabilities'
import { hasCapability } from '@/lib/crm/security/sensitivity'
import { jsonSafe } from '@/lib/crm/services/json-safe'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db, session }) => {
    const target = new URL(req.url).searchParams.get('target') === 'LABOR_GRADE' ? 'LABOR_GRADE' : 'ITEM'
    const rows = await listPriceHistory(db, target, (await params).id)
    const canSeeCost = hasCapability(await viewerOf(db, session), 'cost.view')
    return jsonSafe({ items: rows.filter((r) => canSeeCost || r.field !== 'costPerMm') })
  })
}
