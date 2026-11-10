// POST /api/crm/contracts/[id]/assemble — 모듈을 골라 본문 조립 {version, moduleKeys, dryRun?}. dryRun 이면 저장 없이 들어갈 모듈과 빠진 조항만
import type { NextRequest } from 'next/server'
import { withCrmApi, CONTRACT_HREF, readJson, requireVersion } from '@/lib/crm/api/handler'
import { assembleContractModules, type AssemblyInput } from '@/lib/crm/services/contract-assembly'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    return assembleContractModules(db, session.workspaceId, session.memberId, (await params).id, version, body as AssemblyInput)
  }, { href: CONTRACT_HREF })
}
