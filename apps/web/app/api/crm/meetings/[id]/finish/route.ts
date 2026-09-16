// POST /api/crm/meetings/:id/finish — 「미팅 끝내기」를 **잡으로 남기고 즉시 돌려준다.**
// GET  /api/crm/meetings/:id/finish — 그 잡의 지금 상태 (화면이 「정리 중」을 여기서 읽는다)
//
// ## 왜 바뀌었나 (실측 2026-09-14 「시티큐브 내부 미팅」)
//
// 예전에는 이 POST 하나가 정리와 5축을 잇달아 돌리고 브라우저를 최대 300초 붙잡았다.
//   · 07:55:43 눌림 → 08:00:38 정리본 저장(295초) → 300초 상한에 절단
//   · 5축은 모델을 부르던 중이라 `crm_ai_run` 에 행 하나 못 남겼다 — **실패 기록조차 없다**
//   · 화면을 나가면 단계 보고도 되물음도 통째로 사라졌고, 돌아와도 「정리 중」이 안 보였다
//   · 잠금이 없어 다시 누르면 같은 일이 두 번 돌았다
//
// 상한을 올려서 푸는 문제가 아니다 — 회의가 길어지면 어떤 상한이든 다시 만난다.
// 그래서 일을 **다음 실행**으로 넘긴다. 여기는 넘길 것을 적기만 한다.
//
// 넘긴 일은 `app/api/crm/meetings/jobs/finish` 가 굴린다 (브라우저 + 크론 백스톱).
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { createAdminClient } from '@/lib/supabase/server'
import { enqueueFinish, latestFinishJob } from '@/lib/crm/jobs/finish-drain'
import { finishJobView } from '@/lib/crm/jobs/finish-queue'
import { listOpenQuestions } from '@/lib/crm/services/ask-suggest'
import { getCrmDb } from '@/lib/crm/db/client'

export const runtime = 'nodejs'
// 잡 한 줄을 적을 뿐이다. 오래 걸릴 일이 여기 없다
export const maxDuration = 30

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { job, created } = await enqueueFinish(admin, {
      meetingId: id,
      workspaceId: session.workspaceId,
      actorId: session.memberId,
      // 5축이 「이 사람이 그 노트를 볼 수 있나」를 판정하는 데 쓴다
      hostUserId: session.hostUserId ?? null,
    })
    // 이미 도는 잡이 있으면 새로 만들지 않는다 — 그 계약은 DB 부분 유니크가 지킨다
    return { ...finishJobView(job), jobId: job.id, created }
  })
}

/**
 * 지금 어디까지 왔나.
 *
 * 화면이 이걸 되물어 「정리 중」을 띄우고 버튼을 잠근다. **나갔다 와도 같은 답이 나온다** —
 * 진행이 화면 안 상태가 아니라 표에 있기 때문이다. 그게 이 판에서 고친 것의 전부다.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const job = await latestFinishJob(admin, id)

    const db = getCrmDb(session.workspaceId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meeting = await (db as any).crmMeeting.findFirst({
      where: { id }, select: { id: true, endedAt: true, companyId: true, dealId: true },
    }) as { id: string; endedAt: Date | null; companyId: string | null; dealId: string | null } | null

    // 되물음은 잡이 끝난 뒤에만 뜻이 있다 — 도는 중에 보여 주면 아직 모르는 것을 물어보는 셈이다
    let questions: Awaited<ReturnType<typeof listOpenQuestions>> = []
    if (meeting && job && !finishJobView(job).running) {
      try {
        questions = await listOpenQuestions(db, {
          meetingId: id, companyId: meeting.companyId, dealId: meeting.dealId,
        })
      } catch {
        // 질문을 못 만든 것이 진행 조회를 실패로 만들지 않는다
        questions = []
      }
    }

    return {
      ...finishJobView(job),
      jobId: job?.id ?? null,
      endedAt: meeting?.endedAt ? meeting.endedAt.toISOString() : null,
      questions,
    }
  })
}
