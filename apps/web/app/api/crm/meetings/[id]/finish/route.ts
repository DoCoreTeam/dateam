// POST /api/crm/meetings/:id/finish — 「미팅 끝내기」. 한 번에 끝난 시각·정리·5축·되물음까지.
//
// 예전에는 화면 셋을 오가며 세 번 눌러야 같은 결과가 나왔다. 차에 타면서 그걸 다 하는
// 사람은 없다 — 그래서 하나로 묶었다(`lib/crm/services/meeting-finish.ts`).
//
// **한 단계가 넘어져도 나머지는 간다.** 그래서 이 라우트는 부분 실패에 500 을 내지 않는다.
// 무엇이 됐고 무엇이 안 됐는지 `steps` 로 그대로 내려보내고, 화면이 사람 말로 옮긴다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { finishMeeting } from '@/lib/crm/services/meeting-finish'
import { adapterFromSetting } from '@/lib/crm/services/quick-create'
import { runMeetingDigest } from '@/lib/meeting/digest-run'

export const runtime = 'nodejs'
// 정리와 5축을 잇달아 부른다 — 60분 회의는 기본 상한으로 잘린다(정리 라우트와 같은 이유)
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    return finishMeeting(session.workspaceId, session.memberId, id, {
      adapter: await adapterFromSetting(db),
      // 전사가 없으면 원본 본문을 재료로 끌어온다 — 볼 수 있는 사람인지 판정에 쓴다
      hostUserId: session.hostUserId,
      // 원본 회의노트는 **주인만** 정리할 수 있다 — 남의 노트면 여기서 실패하고,
      // 서비스가 그걸 '정리 실패'로 기록한 뒤 5축은 그대로 진행한다
      digest: async (noteId: string) => {
        const out = await runMeetingDigest(noteId, session.hostUserId)
        return { agendaCount: out.digest?.agenda?.length ?? 0 }
      },
    })
  })
}
