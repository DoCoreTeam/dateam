// POST /api/crm/pricebook/items/[id]/confirm — 확인 전 가격을 확인함으로 (관리자)
// 확인한 사람과 날짜가 가격 이력에 남는다
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { confirmItem } from '@/lib/crm/services/pricebook'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    await confirmItem(session.workspaceId, session.memberId, (await params).id)
    return { ok: true }
  })
}
