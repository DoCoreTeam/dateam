// GET  /api/crm/contracts?dealId= — 딜의 계약서 목록
// GET  /api/crm/contracts?q=&status=&trash=1&limit=&cursor= — 워크스페이스 계약서 목록 (dealId 가 없을 때)
// POST /api/crm/contracts         — 계약서 만들기, 딜 없이 {direction, title, parties[], dealId?, templateId?, formOwner?, docLayer?, manual?} 또는 견적에서 {quoteId, templateId?, title?, manual?}
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { CONTRACT_MSG } from '@/lib/terms/contract-doc'
import { listContracts, listDealContracts, createContractFromQuote, type CreateContractInput } from '@/lib/crm/services/contract'
import { createContract, type CreateContractBlankInput } from '@/lib/crm/services/contract-create'

export async function GET(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ db }) => {
    const sp = req.nextUrl.searchParams
    if (sp.has('dealId')) {
      const dealId = sp.get('dealId')
      if (!dealId) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.dealRequired, { field: 'dealId' })
      return { items: await listDealContracts(db, dealId) }
    }
    return listContracts(db, {
      q: sp.get('q'), status: sp.get('status'), trash: sp.get('trash') === '1',
      limit: Number(sp.get('limit')) || undefined, cursor: sp.get('cursor'),
    })
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const body = await readJson(req)
    if (body && typeof body === 'object' && 'quoteId' in body) {
      return createContractFromQuote(db, session.workspaceId, session.memberId, body as CreateContractInput)
    }
    return createContract(db, session.workspaceId, session.memberId, body as CreateContractBlankInput)
  })
}
