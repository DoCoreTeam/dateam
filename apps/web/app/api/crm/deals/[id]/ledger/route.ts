import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getLedger, toLedgerJson } from '@/lib/crm/services/ledger'
import { viewerOf } from '@/lib/crm/auth/capabilities'

type Ctx = { params: { id: string } }

/** 딜의 매출 인식 장부 — 화면은 이 하나만 부르고 뺄셈을 하지 않는다 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db, session }) =>
    toLedgerJson(await getLedger(db, params.id), await viewerOf(db, session)))
}
