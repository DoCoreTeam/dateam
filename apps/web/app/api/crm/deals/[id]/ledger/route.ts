import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getLedger, updateLedgerMeta, toLedgerJson, type LedgerMetaInput } from '@/lib/crm/services/ledger'
import { viewerOf } from '@/lib/crm/auth/capabilities'

type Ctx = { params: { id: string } }

/** 딜의 매출 인식 장부 — 화면은 이 하나만 부르고 뺄셈을 하지 않는다 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db, session }) =>
    toLedgerJson(await getLedger(db, params.id), await viewerOf(db, session)))
}

/** 장부의 기준을 고친다 — 부가세 방향·세율·예산·계약 금액 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const viewer = await viewerOf(db, session)
    const body = await readJson(req) as unknown as LedgerMetaInput
    return toLedgerJson(await updateLedgerMeta(db, params.id, body, session.memberId), viewer)
  })
}
