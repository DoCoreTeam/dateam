// app/api/ci/signals/sweep/route.ts — 사용자가 직접 「지금 찾기」
//
// 왜 주기만으로는 부족한가(실측 2026-09-01):
//   자동 수집은 12시간마다 돈다. 그 사이에 실패하면 사용자는 **다음 주기까지**
//   빈 화면만 본다. 게다가 세 번 실패한 잡은 죽어서 영영 다시 돌지 않았다.
//   그래서 「지금 찾기」는 ① 죽은 잡을 치우고 ② 그 자리에서 실행해 ③ 결과를 돌려준다.
//
// 왜 큐에 넣지 않고 여기서 바로 도는가:
//   큐에 넣고 «넣었어요»만 답하면 사용자는 또 아무 일도 안 일어난 화면을 본다.
//   버튼을 누른 사람은 **결과**를 기다리고 있으므로 실패도 그 자리에서 말해야 한다.

import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { runSignalSweep } from '@/lib/ci/ai/signals-server'
import { createAdminClient } from '@/lib/supabase/server'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 웹 검색은 오래 걸린다. 화면의 시간 제한(90초)보다 짧게 잡아 서버가 먼저 답하게 한다. */
export const maxDuration = 80

export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const adminClient = createAdminClient() as any

    // 죽은 잡은 건드리지 않는다 — 상태 줄이 «더 최근에 일어난 일»을 보므로
    // 이번 실행이 성공하면 그 기록이 자연히 앞선다(getSignalSweepState).
    const r = await runSignalSweep(session.workspaceId)

    // 다음 자동 주기의 기준을 지금으로 옮긴다 — 방금 돌았는데 또 도는 것을 막는다
    if (r.ok) {
      await adminClient.from('ci_workspaces')
        .update({ last_signal_sweep_at: new Date().toISOString() })
        .eq('id', session.workspaceId)
    }

    if (!r.ok) {
      // 한도 소진은 «고장»이 아니라 «지금은 못 한다»다 — 코드를 나눠야 화면이 다른 말을 할 수 있다
      const msg = r.errorMessage ?? r.note ?? '이슈를 찾지 못했습니다'
      const quota = /한도|quota|RESOURCE_EXHAUSTED|429/i.test(msg)
      return fail(quota ? 'QUOTA_EXHAUSTED' : 'INTERNAL', msg)
    }
    return ok({ found: r.found ?? 0, inserted: r.inserted ?? 0, note: r.note ?? null })
  } catch (e) {
    return failUnexpected(e)
  }
}
