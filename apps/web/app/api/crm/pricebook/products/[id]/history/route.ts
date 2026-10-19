// GET /api/crm/pricebook/products/[id]/history — 이 제품 품목들의 정상가 흐름 (상세의 변경 이력 탭)
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { listProductHistory } from '@/lib/crm/services/pricebook-history'
import { jsonSafe } from '@/lib/crm/services/json-safe'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => jsonSafe({ items: await listProductHistory(db, (await params).id) }))
}
