// GET    /api/crm/stages/:id — 지우기 전에 무엇이 걸려 있는지
// PATCH  /api/crm/stages/:id — 진입 조건 바꾸기 · 이름 바꾸기
// DELETE /api/crm/stages/:id — 단계 지우기 (딜 0건일 때만)
//
// 진입 조건은 "이 단계까지 왔으면 최소한 이건 정해졌다"는 약속이다.
// 그 약속을 관리자가 이 경로로 정하고, 딜 이동이 그걸 실제로 본다(deal.ts checkEntryCriteria).
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { setStageCriteria, previewCriterionImpact } from '@/lib/crm/services/pipeline'
import { ALL_CRITERIA, type CriterionKey } from '@/lib/crm/domain/entry-criteria'
import { getCrmDb } from '@/lib/crm/db/client'
import { stageUsage, renameStage, deleteStage } from '@/lib/crm/services/pipeline-admin'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    // 이름과 조건은 서로 다른 일이라 한 번에 섞지 않는다 — 섞으면 무엇이 바뀌었는지 기록이 흐려진다
    if (typeof body.name === 'string') {
      return { stage: await renameStage(session.workspaceId, session.memberId, id, body.name) }
    }
    // 조건과 '단계의 뜻'은 같은 저장에 실린다 — 둘을 따로 저장하면 한쪽만 반영되는 순간이 생긴다.
    return setStageCriteria(session.workspaceId, session.memberId, id, {
      criteria: body.criteria, meaning: body.meaning,
    })
  })
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    // ?criterion=amount — 그 조건을 켜면 지금 몇 건이 걸리는지. 켜기 전에 보여 주려고 있다.
    const criterion = req.nextUrl.searchParams.get('criterion')
    if (criterion) {
      /**
       * 모르는 이름이면 **거절한다.**
       * 예전엔 조용히 usage 로 흘러가 200 을 돌려줬다 — 화면은 impact 를 기대하므로
       * 미리보기가 **아무 말 없이** 안 뜬다. 틀린 요청이 성공처럼 보이는 것이 가장 나쁘다.
       */
      if (!ALL_CRITERIA.includes(criterion as CriterionKey)) {
        throw new CrmError(
          'VALIDATION_FAILED',
          `모르는 조건입니다: ${criterion}. ${ALL_CRITERIA.join(' · ')} 중에서 골라 주세요.`,
          { field: 'criterion' },
        )
      }
      return { impact: await previewCriterionImpact(db, id, criterion as CriterionKey) }
    }
    return { usage: await stageUsage(db, id) }
  })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('ADMIN', async ({ session }) => {
    return { deleted: await deleteStage(session.workspaceId, session.memberId, id) }
  })
}
