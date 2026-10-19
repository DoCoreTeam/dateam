// POST /api/crm/pricebook/products/[id]/items — 이 제품에 품목 더하기 (관리자)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { saveItem } from '@/lib/crm/services/pricebook'
import { parseItem } from '@/lib/crm/services/pricebook-input'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    const { id: _ignored, ...item } = parseItem(body)
    void _ignored
    return saveItem(session.workspaceId, session.memberId, (await params).id, item, Number(body.position ?? 0) || 0)
  })
}
