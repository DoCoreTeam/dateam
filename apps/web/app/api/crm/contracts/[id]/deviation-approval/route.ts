// GET  /api/crm/contracts/[id]/deviation-approval — 지금 버전의 표준 이탈 목록, 승인 기록, 체결 가능 여부
// POST /api/crm/contracts/[id]/deviation-approval — 지금 버전의 이탈 승인 {version, note?} (관리자). 서비스가 역할을 다시 본다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { approveContractDeviations, getDeviationState } from '@/lib/crm/services/contract-deviation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db }) => getDeviationState(db, (await params).id))
}

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ db, session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    const note = (body as { note?: unknown }).note
    return approveContractDeviations(db, session.workspaceId, { memberId: session.memberId, role: session.role }, (await params).id, version, note)
  })
}
