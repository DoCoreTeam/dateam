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
import { loadNoteMeta } from '@/lib/crm/services/meeting-publish'
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
      ? await loadNoteMeta(meeting.noteId, session.hostUserId, meeting.noteSyncedAt)
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
    return updateMeeting(session.workspaceId, session.memberId, id, patch)
  })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    await deleteMeeting(session.workspaceId, session.memberId, id)
    return { ok: true }
  })
}
