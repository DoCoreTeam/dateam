// GET    /api/crm/meetings/:id — 미팅 상세 + 전사 + 5축 제안
// PATCH  /api/crm/meetings/:id — 제목·시각·회사·딜·장소 고치기
// DELETE /api/crm/meetings/:id — 휴지통으로
//
// PATCH 가 없어서 **오타 하나에 미팅을 지우고 다시 만들어야 했다.**
// 그런데 지우면 그 미팅에서 나온 미처리 제안까지 함께 거둬진다 — 고치는 값이 너무 비쌌다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { getMeeting, listSegments, listMeetingSuggestions, deleteMeeting, updateMeeting } from '@/lib/crm/services/meeting'
import { loadNoteMeta, syncNoteTitle } from '@/lib/crm/services/meeting-publish'
import { CrmError } from '@/lib/crm/domain/errors'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    const meeting = await getMeeting(db, id)
    if (!meeting) throw new CrmError('NOT_FOUND', '미팅을 찾을 수 없습니다.')

    // 전사는 가장 최근 것 하나 — 여러 번 올렸으면 마지막이 정본이다
    const latest = meeting.recordings.find((r: { status: string }) => r.status === 'TRANSCRIBED')
    const segments = latest ? await listSegments(db, latest.id) : []

    // 이 미팅에서 나온 제안 전부 — 딜·인물로 간 것까지(그것들이 이 미팅의 성과다)
    const suggestions = await listMeetingSuggestions(db, id)

    /**
     * 원본 회의노트 상태. 본문은 안 준다 — CRM 은 스냅샷을 이미 갖고 있고,
     * 공개 범위(D6)를 넘어 본문을 흘리면 '나만 보기'로 둔 사람의 기대가 깨진다.
     * 원본이 그 뒤 수정됐으면 화면이 "다시 가져오기"를 띄운다.
     */
    const note = meeting.noteId
      // 지금 CRM 제목을 함께 넘긴다 — 원본과 어긋났는지 서버가 판정해 준다(§syncNoteTitle 주석)
      ? await loadNoteMeta(meeting.noteId, session.hostUserId, meeting.noteSyncedAt, meeting.title)
      : null

    return { ...meeting, segments, suggestions, note }
  })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    // 안 보낸 필드는 건드리지 않는다 — 부분 수정이다.
    // null 은 "비우기"라는 뜻이므로 undefined 와 구분해서 넘긴다.
    const patch: Parameters<typeof updateMeeting>[3] = {}
    if (typeof body.title === 'string') patch.title = body.title
    if (typeof body.startedAt === 'string') patch.startedAt = body.startedAt
    if (body.endedAt === null || typeof body.endedAt === 'string') patch.endedAt = body.endedAt
    if (body.companyId === null || typeof body.companyId === 'string') patch.companyId = body.companyId
    if (body.dealId === null || typeof body.dealId === 'string') patch.dealId = body.dealId
    if (body.location === null || typeof body.location === 'string') patch.location = body.location
    const updated = await updateMeeting(session.workspaceId, session.memberId, id, patch)

    /**
     * **제목은 한 벌이다.** CRM 에서 고쳤으면 원본 회의노트도 같이 고친다.
     *
     * 미팅 저장이 성공한 뒤에 한다 — 순서를 뒤집으면 미팅 저장이 실패했는데 원본만 바뀐다.
     * 내 노트가 아니면 `not_owner` 가 돌아오고 아무것도 쓰지 않는다(권한 경계).
     * 결과를 응답에 실어 화면이 무슨 일이 일어났는지 말할 수 있게 한다 — 조용히 넘기지 않는다.
     */
    const titleSync = typeof body.title === 'string'
      ? await syncNoteTitle(session.workspaceId, session.hostUserId, id, body.title)
      : null
    return { ...updated, titleSync }
  })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    await deleteMeeting(session.workspaceId, session.memberId, id)
    return { ok: true }
  })
}
