// POST /api/crm/quick-create — 붙여넣기 한 번으로 회사·인물·딜 만들기 (명세 §3.1)
//
// 실패해도 원문은 응답에 담아 돌려준다 — 화면이 그걸로 재시도 버튼을 만든다.
// 원문을 안 돌려주면 사용자는 붙여넣은 것을 다시 찾아와야 한다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { quickCreate, type QuickCreateInput } from '@/lib/crm/services/quick-create'

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    return quickCreate(session.workspaceId, session.memberId, body as unknown as QuickCreateInput)
  })
}
