// GET  /api/crm/contracts?dealId= — 딜의 계약서 목록
// POST /api/crm/contracts         — 보냄 또는 수락 견적으로 계약서 만들기 {quoteId, templateId?, title?, manual?}
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { CONTRACT_MSG } from '@/lib/terms/contract-doc'
import { listDealContracts, createContractFromQuote, type CreateContractInput } from '@/lib/crm/services/contract'

export async function GET(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ db }) => {
    const dealId = req.nextUrl.searchParams.get('dealId')
    if (!dealId) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.dealRequired, { field: 'dealId' })
    return { items: await listDealContracts(db, dealId) }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const body = await readJson(req)
    return createContractFromQuote(db, session.workspaceId, session.memberId, body as CreateContractInput)
  })
}
