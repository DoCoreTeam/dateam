// GET   /api/meeting-notes/:id — 회의 작업대가 읽는 한 건 (읽기 권한은 RLS 가 판정)
// PATCH /api/meeting-notes/:id — 본문·제목·공개범위 부분 수정 (**주인만**)
// DELETE /api/meeting-notes/:id — 휴지통으로 (**주인만**)
//
// **왜 서버액션이 아니라 API 인가.** 작업대는 두 셸((member)·(crm))이 같이 쓴다.
// CRM 쪽은 전부 fetch 로 말하고 있어 여기만 서버액션이면 창구가 둘이 된다.
// 그리고 자동저장은 5초마다 부른다 — 기존 `updateMeetingNote` 는 호출마다
// 캘린더 동기화 + revalidate 까지 하므로 그 경로를 그대로 쓰면 안 된다.
//
// 읽기와 쓰기의 권한이 **다르다**:
//   · 읽기 = RLS 그대로 (본인 / admin / 이 노트를 원본으로 삼은 CRM 미팅의 워크스페이스 멤버)
//   · 쓰기 = 주인만. 마이그 216 주석 그대로 — "읽기 공개이지 편집 공개가 아니다".
//     남이 내 회의노트를 고치게 되면 그건 공개가 아니라 양도다.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { htmlToPlain } from '@/lib/html-to-plain'
import { NOTE_VISIBILITY, isNoteVisibility } from '@/lib/meeting/note-visibility'
import { deleteMeetingNote } from '@/app/(member)/meeting-notes/actions'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const COLUMNS =
  'id, user_id, title, meeting_at, status, visibility, body_html, body_plain, ' +
  'summary, decisions, attendees, created_at, updated_at'

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('meeting_notes') as any)
    .select(COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return NextResponse.json({ error: '회의노트를 불러오지 못했습니다.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: '회의노트를 찾을 수 없습니다.' }, { status: 404 })

  /**
   * 전사가 **있는지만** 함께 준다 — 작업대가 처음 열 탭을 정하는 데 쓴다.
   *
   * 내용은 주지 않는다. 전사 탭이 열릴 때 따로 읽으므로 여기서 실으면 같은 것을 두 번 보낸다.
   * RLS 가 부모(회의노트) 권한을 그대로 따르므로 남의 노트에서는 0 이 나온다(마이그 217).
   */
  let hasTranscript = false
  let transcriptSegments = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: partRows } = await (supabase.from('meeting_recording_part') as any)
    .select('id').eq('note_id', id)
  const partIds = ((partRows ?? []) as { id: string }[]).map((p) => p.id)
  if (partIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabase.from('meeting_transcript_segment') as any)
      .select('id', { count: 'exact', head: true }).in('part_id', partIds)
    transcriptSegments = count ?? 0
    hasTranscript = transcriptSegments > 0
  }

  return NextResponse.json({
    id: data.id,
    title: data.title,
    meetingAt: data.meeting_at,
    status: data.status,
    visibility: isNoteVisibility(data.visibility) ? data.visibility : NOTE_VISIBILITY.PRIVATE,
    bodyHtml: data.body_html ?? '',
    bodyPlain: data.body_plain ?? '',
    summary: data.summary ?? '',
    decisions: data.decisions ?? '',
    attendees: Array.isArray(data.attendees) ? data.attendees : [],
    updatedAt: data.updated_at,
    /** 근거를 펼쳤을 때 어느 쪽을 열지 정한다(§lib/meeting/workbench-tab.ts) */
    hasTranscript,
    /**
     * 받아적은 줄 수 — 탭이 안 떠도 답할 수 있게 서버가 함께 준다.
     * 근거가 접혀 있으면 전사 뷰가 마운트되지 않아 화면이 이 값을 스스로 셀 수 없다.
     */
    transcriptSegments,
    /** 읽을 수는 있어도 고칠 수는 없는 사람이 있다 — 화면이 편집기를 그릴지 여기로 정한다 */
    canEdit: data.user_id === user.id,
    /**
     * 지금 보고 있는 사람. **임시저장 키를 사람마다 가르는 데 쓴다.**
     *
     * 브라우저 임시저장(`useDraftPersist`)은 키에 사용자를 넣게 돼 있는데, 회의 메모는
     * 그 값을 아무도 안 넘겨 실제 키가 `draft:v1:anon:meeting-memo:<노트>` 였다(실측
     * v0.7.711). 공용 PC 에서 한 노트를 함께 고치는 두 사람이 **같은 초안 칸**을 쓰게 된다.
     * 화면마다 prop 으로 넘기게 하면 또 빠뜨리므로 서버가 준다.
     */
    viewerId: user.id,
  })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  let body: { bodyHtml?: unknown; title?: unknown; visibility?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const payload: Record<string, unknown> = {}

  if (typeof body.bodyHtml === 'string') {
    if (body.bodyHtml.length > 500_000) {
      return NextResponse.json({ error: '본문이 너무 깁니다.' }, { status: 400 })
    }
    payload.body_html = body.bodyHtml
    // plain 은 파생값이다 — 따로 받지 않는다. AI 입력·인용이 이걸 쓴다(§5-1)
    payload.body_plain = htmlToPlain(body.bodyHtml)
  }

  if (typeof body.title === 'string') {
    const t = body.title.trim()
    if (!t) return NextResponse.json({ error: '제목을 입력해 주세요.' }, { status: 400 })
    if (t.length > 200) return NextResponse.json({ error: '제목이 너무 깁니다.' }, { status: 400 })
    payload.title = t
  }

  if (body.visibility !== undefined) {
    if (!isNoteVisibility(body.visibility)) {
      return NextResponse.json({ error: '공개 범위 값이 올바르지 않습니다.' }, { status: 400 })
    }
    payload.visibility = body.visibility
  }

  if (Object.keys(payload).length === 0) return NextResponse.json({ ok: true, unchanged: true })

  // `.eq('user_id')` 가 쓰기 권한이다. RLS 가 1차, 이 조건이 2차 방어.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('meeting_notes') as any)
    .update(payload)
    .eq('id', id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .select('id, updated_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: `저장하지 못했습니다: ${error.message}` }, { status: 500 })
  // 행이 안 잡히면 남의 노트다 — 조용히 성공으로 돌려주면 사용자는 저장된 줄 안다
  if (!data) {
    return NextResponse.json(
      { error: '이 회의노트는 작성한 사람만 고칠 수 있어요.' },
      { status: 403 },
    )
  }

  return NextResponse.json({ ok: true, updatedAt: data.updated_at })
}

/**
 * DELETE — 회의노트를 휴지통으로.
 *
 * **왜 API 가 필요한가**: 지우는 로직(`deleteMeetingNote`)은 진작 있었지만 **서버 액션**이라
 * `(member)` 셸의 두 화면에서만 부를 수 있었다. 영업 CRM 의 기록 목록에는 아직 CRM 에 안 올린
 * 회의노트가 함께 서는데, 그 행을 지울 창구가 없어 **목록에서 아무것도 못 지웠다**
 * (사용자 지적 2026-09-09: 「여기 삭제가 왜 하나도 없니? CRUD 기본인데」).
 *
 * 로직은 다시 짜지 않고 그대로 부른다 — 소프트 삭제·캘린더 정리·파생 일일업무 비우기가
 * 이미 그 안에 있다. 여기서 다시 구현하면 두 벌이 되고 한쪽만 고쳐진다.
 *
 * 권한은 액션이 강제한다: **본인이 쓴 노트만.** 남의 노트는 0행 → 명시 오류로 돌아온다.
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const res = await deleteMeetingNote(id)
  if (!res.ok) {
    /*
      실패를 셋으로 가른다 — 전부 500 으로 뭉개면 화면이 "잠시 후 다시"라고 말하는데
      다시 눌러도 100% 같다.
        · 「인증이 필요합니다」 → 401 (로그인하면 된다)
        · 「찾을 수 없다 · 잘못된 식별자」 → 404 (대상이 없다 — 권한 문제로 읽히면 안 된다)
        · 그 밖(「본인이 작성한 …만」) → 403 (권한)
    */
    const msg = res.error ?? ''
    const status = msg.includes('인증') ? 401
      : (msg.includes('찾을 수 없') || msg.includes('식별자')) ? 404
        : 403
    return NextResponse.json({ error: res.error ?? '삭제하지 못했습니다.' }, { status })
  }
  return NextResponse.json({ ok: true })
}
