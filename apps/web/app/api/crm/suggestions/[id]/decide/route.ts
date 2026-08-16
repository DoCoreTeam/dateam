// POST /api/crm/suggestions/[id]/decide — 수락·수정 후 수락·거절 (명세 §3.3)
//
// 수락은 코어 데이터를 바꾼다. 그래서 MEMBER 이상만, 그리고 낙관적 잠금을 거친다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { decideSuggestion, type DecideInput } from '@/lib/crm/services/suggestion'
import { CrmError } from '@/lib/crm/domain/errors'

type Ctx = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const decision = body.decision
    if (decision !== 'accept' && decision !== 'reject') {
      throw new CrmError('VALIDATION_FAILED', '수락 또는 거절만 가능합니다.', { field: 'decision' })
    }
    return decideSuggestion(session.workspaceId, session.memberId, params.id, body as unknown as DecideInput)
  })
}
