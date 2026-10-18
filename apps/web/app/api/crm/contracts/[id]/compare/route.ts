// GET /api/crm/contracts/[id]/compare?a=1&b=2 — 두 버전 비교 (조항 차이와 칸 값 차이)
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { CONTRACT_MSG } from '@/lib/terms/contract-doc'
import { compareContractVersions } from '@/lib/crm/services/contract'

type Ctx = { params: Promise<{ id: string }> }

function versionNo(raw: string | null, field: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.badVersionNo, { field })
  return n
}

export async function GET(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db }) => {
    const sp = req.nextUrl.searchParams
    return compareContractVersions(db, (await params).id, versionNo(sp.get('a'), 'a'), versionNo(sp.get('b'), 'b'))
  })
}
