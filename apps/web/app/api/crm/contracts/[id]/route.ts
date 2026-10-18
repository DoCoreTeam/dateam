// GET   /api/crm/contracts/[id] — 계약서, 지금 버전, 칸을 채운 본문, 견적 변경 여부
// PATCH /api/crm/contracts/[id] — 고친 본문 칸 값 제목으로 다음 버전 {version, body?, manual?, title?, note?}
//                                 {version, refill: true} 이면 지금 견적 값으로 자동 칸을 다시 채운 다음 버전
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { getContract, refillContractFromQuote, saveContractVersion, type SaveContractInput } from '@/lib/crm/services/contract'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db }) => getContract(db, (await params).id))
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    const id = (await params).id
    if ((body as { refill?: unknown }).refill === true) {
      return refillContractFromQuote(db, session.workspaceId, session.memberId, id, version)
    }
    return saveContractVersion(session.workspaceId, session.memberId, id, version, body as SaveContractInput)
  })
}
