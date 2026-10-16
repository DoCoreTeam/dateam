// POST /api/crm/contract-templates/[id]/publish — 작성 중 본문을 다음 버전으로 굳힌다 (관리자)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { publishContractTemplate } from '@/lib/crm/services/contract-template'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    return publishContractTemplate(session.workspaceId, session.memberId, (await params).id, version)
  })
}
