// POST /api/crm/pricebook/products/[id]/restore — 휴지통에서 되살리기 (관리자)
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { restorePriceProduct } from '@/lib/crm/services/pricebook'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    await restorePriceProduct(session.workspaceId, session.memberId, (await params).id)
    return { ok: true }
  })
}
