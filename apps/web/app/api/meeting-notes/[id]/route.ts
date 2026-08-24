// GET   /api/meeting-notes/:id — 회의 작업대가 읽는 한 건 (읽기 권한은 RLS 가 판정)
// PATCH /api/meeting-notes/:id — 본문·제목·공개범위 부분 수정 (**주인만**)
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
    /** 읽을 수는 있어도 고칠 수는 없는 사람이 있다 — 화면이 편집기를 그릴지 여기로 정한다 */
    canEdit: data.user_id === user.id,
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
