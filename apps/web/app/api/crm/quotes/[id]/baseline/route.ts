// GET /api/crm/quotes/[id]/baseline — 기준 대조 결과 (막음과 알림)
// 보내기 전에 화면이 펼쳐 보인다. 보내기 창구도 같은 검사를 다시 돌아 막을 것은 막는다
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { withCrmTx } from '@/lib/crm/db/tx'
import { baselineFindings } from '@/lib/crm/services/quote-pricebook-hooks'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ session }) => {
    const id = (await params).id
    const items = await withCrmTx(session.workspaceId, (tx) => baselineFindings(tx, id))
    return { items }
  })
}
