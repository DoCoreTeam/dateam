// GET  /api/crm/meetings — 미팅 목록
// POST /api/crm/meetings — 미팅 만들기
//
// 미팅은 "그날 무슨 이야기가 오갔는지"를 딜에 붙이는 자리다.
// 이게 없으면 딜은 금액과 단계만 남은 껍데기가 된다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { listMeetings, createMeeting } from '@/lib/crm/services/meeting'
import { createMeetingWithNote } from '@/lib/crm/services/meeting-publish'
import { CrmError } from '@/lib/crm/domain/errors'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    return {
      items: await listMeetings(db, {
        dealId: req.nextUrl.searchParams.get('dealId') ?? undefined,
        companyId: req.nextUrl.searchParams.get('companyId') ?? undefined,
        noteId: req.nextUrl.searchParams.get('noteId') ?? undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50) || 50,
      }),
    }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const title = typeof body.title === 'string' ? body.title : ''
    const startedAt = typeof body.startedAt === 'string' ? body.startedAt : ''
    if (!title || !startedAt) {
      throw new CrmError('VALIDATION_FAILED', '제목과 시각을 입력해 주세요.', { field: 'title' })
    }
    /**
     * `withNote` 면 회의노트도 함께 만든다(사용자 결정 D5).
     *
     * 원본은 회의노트 하나라고 정해 놓고 CRM 에서만 만들면 원본 없는 미팅이 생긴다 —
     * 그러면 같은 회의가 또 두 벌이 되고, 이 기획이 없애려던 상태로 돌아간다.
     * 안 보내면 기존 동작 그대로다(추가 전용).
     */
    if (body.withNote === true) {
      return createMeetingWithNote(session.workspaceId, session.memberId, session.hostUserId, {
        title, startedAt,
        companyId: typeof body.companyId === 'string' ? body.companyId : null,
        dealId: typeof body.dealId === 'string' ? body.dealId : null,
        location: typeof body.location === 'string' ? body.location : null,
      })
    }

    return createMeeting(session.workspaceId, session.memberId, {
      title, startedAt,
      endedAt: typeof body.endedAt === 'string' ? body.endedAt : null,
      companyId: typeof body.companyId === 'string' ? body.companyId : null,
      dealId: typeof body.dealId === 'string' ? body.dealId : null,
      location: typeof body.location === 'string' ? body.location : null,
    })
  })
}
