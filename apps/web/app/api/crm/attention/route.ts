// GET /api/crm/attention — 지금 봐야 할 것
//
// 알림을 쌓지 않는다. **지금 상태**를 본다 — 조치하면 사라지는 것이 곧 읽음이다
// (lib/crm/services/attention.ts 의 설명 참조).
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { buildAttention, attentionSummary } from '@/lib/crm/services/attention'
import { loadMyScope } from '@/lib/crm/services/my-scope'

export async function GET() {
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    /*
      뱃지는 **내 것만** 센다.
      머리에 뜬 숫자를 누르고 도착한 화면이 다른 숫자를 보이면 그 뱃지는 실패한 것이다
      (배지 규칙 · lib/terms/badge.ts). 오늘 화면의 기본 탭도 「내 담당」이라 둘이 같은 답을 낸다.
    */
    const my = await loadMyScope(db, session.memberId, session.role)
    const attention = await buildAttention(db, my.mine)
    return { ...attention, summary: attentionSummary(attention) }
  })
}
