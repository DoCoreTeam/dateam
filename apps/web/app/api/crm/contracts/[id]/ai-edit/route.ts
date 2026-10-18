// POST  /api/crm/contracts/[id]/ai-edit — 지시로 고칠 조각 제안, 저장하지 않음 {instruction}
// PATCH /api/crm/contracts/[id]/ai-edit — 받은 조각만 다음 버전으로 {version, instruction, pieces}
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { proposeContractEdit, applyContractEdit, type ApplyContractEditInput } from '@/lib/crm/services/contract-ai'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const body = (await readJson(req)) as { instruction?: unknown }
    return proposeContractEdit(db, session.workspaceId, session.memberId, (await params).id, body.instruction)
  })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    return applyContractEdit(db, session.workspaceId, session.memberId, (await params).id, version, body as ApplyContractEditInput)
  })
}
