// POST /api/crm/labor-grades/[id]/restore — 숨긴 등급을 다시 보이기 (관리자)
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { setLaborGradeActive } from '@/lib/crm/services/labor-grade'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    await setLaborGradeActive(session.workspaceId, session.memberId, (await params).id, true)
    return { ok: true }
  })
}
