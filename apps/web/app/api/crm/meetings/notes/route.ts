// GET /api/crm/meetings/notes — "회의노트에서 가져오기" 고르기 목록 (내 노트만)
//
// 이미 올린 노트도 숨기지 않는다. 숨기면 사용자는 "분명 있었는데"를 겪는다 —
// 대신 표시해 두고, 고르면 기존 미팅으로 데려간다(발행이 멱등이라 그렇게 된다).
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { listMyNotesForPicker } from '@/lib/crm/services/meeting-publish'

export async function GET(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => ({
    items: await listMyNotesForPicker(session.workspaceId, session.hostUserId, {
      q: req.nextUrl.searchParams.get('q') ?? undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 20) || 20,
    }),
  }))
}
