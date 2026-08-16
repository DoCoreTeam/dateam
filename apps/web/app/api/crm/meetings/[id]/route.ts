// GET    /api/crm/meetings/:id — 미팅 상세 + 전사 + 5축 제안
// DELETE /api/crm/meetings/:id — 휴지통으로
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { getMeeting, listSegments, listMeetingSuggestions, deleteMeeting } from '@/lib/crm/services/meeting'
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

    return { ...meeting, segments, suggestions }
  })
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    await deleteMeeting(session.workspaceId, session.memberId, id)
    return { ok: true }
  })
}
