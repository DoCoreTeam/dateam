// POST /api/crm/deals/[id]/stage — 단계 이동 (딜 갱신 + 이력이 한 트랜잭션, DI-09)
//
// 일반 PATCH 로 stageId 를 바꾸는 길은 서비스가 막는다 —
// 우회로가 열려 있으면 이력 없는 이동이 생기고, 영업 사이클이 거짓이 된다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { moveDealStage, toDealJson } from '@/lib/crm/services/deal'
import { CrmError } from '@/lib/crm/domain/errors'

type Ctx = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    const toStageId = typeof body.toStageId === 'string' ? body.toStageId : ''
    if (!toStageId) {
      throw new CrmError('VALIDATION_FAILED', '옮길 단계를 지정해 주세요.', { field: 'toStageId' })
    }
    const deal = await moveDealStage(session.workspaceId, session.memberId, params.id,
      { version, toStageId })
    return toDealJson(deal)
  })
}
