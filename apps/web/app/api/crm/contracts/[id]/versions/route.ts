// GET /api/crm/contracts/[id]/versions          — 버전 기록 (본문 없이)
// GET /api/crm/contracts/[id]/versions?no=N     — 그 버전 하나
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { CONTRACT_MSG } from '@/lib/terms/contract-doc'
import { listContractVersions, getContractVersion } from '@/lib/crm/services/contract'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db }) => {
    const id = (await params).id
    const no = req.nextUrl.searchParams.get('no')
    if (no === null) return { items: await listContractVersions(db, id) }
    const n = Number(no)
    if (!Number.isInteger(n) || n < 1) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.badVersionNo, { field: 'no' })
    return getContractVersion(db, id, n)
  })
}
