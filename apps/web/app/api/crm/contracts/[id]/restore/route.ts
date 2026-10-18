// POST /api/crm/contracts/[id]/restore — 휴지통에서 되살린다 (P0132 I15)
//
// 견적 회사 딜과 같은 약속이다: 지워도 되돌릴 수 있다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { restoreContract } from '@/lib/crm/services/contract'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => restoreContract(session.workspaceId, session.memberId, (await params).id))
}
