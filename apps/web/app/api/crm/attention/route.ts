// GET /api/crm/attention — 지금 봐야 할 것
//
// 알림을 쌓지 않는다. **지금 상태**를 본다 — 조치하면 사라지는 것이 곧 읽음이다
// (lib/crm/services/attention.ts 의 설명 참조).
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { buildAttention, attentionSummary } from '@/lib/crm/services/attention'

export async function GET() {
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    const attention = await buildAttention(db)
    return { ...attention, summary: attentionSummary(attention) }
  })
}
