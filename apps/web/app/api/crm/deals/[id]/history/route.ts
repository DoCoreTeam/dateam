// GET /api/crm/deals/[id]/history — 단계 이동 이력
//
// 딜 상세의 타임라인이 이걸 읽는다. 이력은 append-only 라 페이지네이션 없이 전부 준다 —
// 단계 이동은 딜 하나당 많아야 수십 건이고, 잘라 보여 주면 "언제 시작했나"가 잘린다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { listStageHistory } from '@/lib/crm/services/deal'

type Ctx = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => ({ items: await listStageHistory(db, params.id) }))
}
