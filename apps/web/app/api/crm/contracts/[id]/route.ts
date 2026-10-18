// GET   /api/crm/contracts/[id] — 계약서, 지금 버전, 칸을 채운 본문
// PATCH /api/crm/contracts/[id] — 고친 본문 칸 값 제목으로 다음 버전 {version, body?, manual?, title?, note?}
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { getContract, saveContractVersion, type SaveContractInput } from '@/lib/crm/services/contract'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db }) => getContract(db, (await params).id))
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    return saveContractVersion(session.workspaceId, session.memberId, (await params).id, version, body as SaveContractInput)
  })
}
