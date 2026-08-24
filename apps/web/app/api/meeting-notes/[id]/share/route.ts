// GET  /api/meeting-notes/:id/share — 이 회의가 팀에게 어디까지 보이나
// PUT  /api/meeting-notes/:id/share — 그 상태를 바꾼다
//
// **왜 회의노트 쪽에 두나.** 상태를 고르는 자리가 회의노트 화면이고, 정할 자격도
// 원본 주인에게 있다. CRM 쪽에 두면 "미팅이 아직 없는 상태(나만 보기)"를 표현할 대상이 없다.
//
// **왜 손잡이가 하나인가.** 예전엔 `visibility` PATCH 와 `/unpublish` POST 가 따로 있었고,
// 둘이 서로를 몰라 "나만 보기로 했는데 팀은 그대로 본다"가 됐다(사용자 지적 2026-08-24).

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { readNoteShareState, setNoteShareState } from '@/lib/crm/services/meeting-publish'
import { CHOOSABLE_SHARE_STATES, type MeetingShareState } from '@/lib/meeting/share-state'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('READONLY', async ({ session }) =>
    readNoteShareState(session.workspaceId, id, session.hostUserId))
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const next = body.state

    // 모르는 상태를 그대로 넘기면 조용히 아무 일도 안 하거나 엉뚱한 곳으로 간다
    if (typeof next !== 'string' || !CHOOSABLE_SHARE_STATES.includes(next as MeetingShareState)) {
      throw new CrmError(
        'VALIDATION_FAILED',
        `고를 수 없는 공개 범위입니다. ${CHOOSABLE_SHARE_STATES.join(' · ')} 중에서 골라 주세요.`,
        { field: 'state' },
      )
    }

    return setNoteShareState(session.workspaceId, session.memberId, session.hostUserId, {
      noteId: id,
      next: next as MeetingShareState,
      companyId: typeof body.companyId === 'string' ? body.companyId : null,
      dealId: typeof body.dealId === 'string' ? body.dealId : null,
    })
  })
}

/** 이 라우트는 JSON 봉투를 그대로 쓴다 — 아래는 타입 체크용으로만 쓰이는 참조 */
export const dynamic = 'force-dynamic'
void NextResponse
