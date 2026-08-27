// GET /api/crm/today — 오늘 화면
//
// **왜 이 화면이 생겼나**: `/crm` 이 인박스로 바로 넘겼는데, 인박스는
// "AI 가 찾아낸 제안을 확인하는 곳"이라 **처음 온 사람에겐 구조적으로 비어 있다.**
// 통상의 CRM 첫 화면은 "오늘 할 일 · 다가오는 미팅 · 딜 진행"이다(HubSpot Sales Workspace).
//
// AI 제안은 **따로 받는다**(?ai=1) — 모델 호출이 느려서 같이 묶으면 화면 전체가 기다린다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { buildAttention, attentionSummary } from '@/lib/crm/services/attention'
import { countUnplanned } from '@/lib/crm/services/next-action'
import { suggestNextBestActions } from '@/lib/crm/services/next-best-action'
import { listTodayMeetings } from '@/lib/crm/services/today-meetings'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const wantAi = req.nextUrl.searchParams.get('ai') === '1'

  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)

    // AI 는 느리다 — 같이 묶으면 화면 전체가 모델을 기다린다
    if (wantAi) {
      return { ai: await suggestNextBestActions(db, session.workspaceId) }
    }

    const [attention, unplanned, todayMeetings] = await Promise.all([
      buildAttention(db),
      // 다음 할 일이 없는 딜 수 — 이 숫자가 영업 규율의 지표다
      countUnplanned(db).catch(() => 0),
      /**
       * 시작하기 안내.
       *
       * **다 끝나면 안 보낸다.** 계속 뜨면 그때부터는 화면을 차지하는 장식일 뿐이고,
       * 사람은 "이거 왜 안 없어지지"를 신경 쓰게 된다.
       */
      /**
       * 오늘 잡혀 있는 미팅.
       *
       * 화면 이름이 「오늘」인데 오늘의 미팅이 없었다 — `attention` 은 할 일과 제안만 본다.
       * 실패해도 화면은 뜬다(포착 상자는 이것 없이도 새 미팅을 만들 수 있다).
       */
      listTodayMeetings(db).catch(() => []),
    ])

    return {
      attention: { ...attention, summary: attentionSummary(attention) },
      unplanned,
      todayMeetings,
      displayName: session.displayName,
    }
  })
}
