// GET  /api/crm/meetings — 미팅 목록
// POST /api/crm/meetings — 미팅 만들기
//
// 미팅은 "그날 무슨 이야기가 오갔는지"를 딜에 붙이는 자리다.
// 이게 없으면 딜은 금액과 단계만 남은 껍데기가 된다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, readListQuery } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { listMeetings, listMeetingsPage, createMeeting } from '@/lib/crm/services/meeting'
import { createMeetingWithNote } from '@/lib/crm/services/meeting-publish'
import { CrmError } from '@/lib/crm/domain/errors'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    const sp = req.nextUrl.searchParams

    /**
     * `noteId` 로 부를 때는 **딱 한 가지**를 묻는 것이다 — "이 회의노트가 이미 올라갔나".
     * 커서·검색이 끼면 답이 페이지에 따라 달라진다. 그래서 예전 경로를 그대로 둔다.
     */
    const noteId = sp.get('noteId')
    if (noteId) {
      return { items: await listMeetings(db, { noteId, limit: 5 }) }
    }

    /**
     * 그 밖은 훑는 목록이다 — 딜·회사 상세의 패널도 여기로 온다.
     * 예전엔 상한 50 을 통째로 내려보내고 회사·딜 이름은 화면이 건당 다시 물었다(N+1).
     * 이제 커서·검색·상태가 붙고 이름은 서버가 함께 준다.
     */
    /**
     * `personId` 는 인물 상세의 「이 사람과 한 회의」다.
     * 참석자가 JSON 배열이라 커서 목록(listMeetingsPage)의 where 와 모양이 달라
     * noteId 와 같은 방식으로 예전 경로를 쓴다 — 패널은 최근 몇 건만 보면 된다.
     */
    const personId = sp.get('personId')
    if (personId) {
      return { items: await listMeetings(db, { personId, limit: 10 }) }
    }

    const { cursor, limit, q } = readListQuery(req)
    return listMeetingsPage(db, {
      cursor, limit, q,
      status: sp.get('status'),
      dealId: sp.get('dealId'),
      companyId: sp.get('companyId'),
    })
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
