// POST /api/crm/meetings/from-note — 회의노트를 영업 CRM에 올린다(발행)
//
// 원본은 회의노트 하나다. CRM 은 그 시점의 **스냅샷**을 받는다 —
// 개인이 노트를 지워도 팀의 영업 기록은 살아야 하고, 인박스 제안의 근거가
// 원본 편집으로 깨지면 안 되기 때문이다(통합 기획 §3-1).
//
// **AI 정리는 여기서 돌리지 않는다.** 미팅 상세의 'AI로 정리하기' 버튼이 한다 —
// 사용자가 전사를 먼저 보고 고칠 수 있어야 결과가 맞고, 안 볼 회의까지 비용을 쓸 이유가 없다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { publishFromNote } from '@/lib/crm/services/meeting-publish'
import { CrmError } from '@/lib/crm/domain/errors'

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const noteId = typeof body.noteId === 'string' ? body.noteId.trim() : ''
    if (!noteId) throw new CrmError('VALIDATION_FAILED', '회의노트를 골라 주세요.', { field: 'noteId' })

    return publishFromNote(session.workspaceId, session.memberId, session.hostUserId, {
      noteId,
      companyId: typeof body.companyId === 'string' && body.companyId ? body.companyId : null,
      dealId: typeof body.dealId === 'string' && body.dealId ? body.dealId : null,
    })
  })
}
