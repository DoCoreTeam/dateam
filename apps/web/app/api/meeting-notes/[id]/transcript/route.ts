// GET   /api/meeting-notes/:id/transcript — 받아적은 것을 시간순으로
// PATCH /api/meeting-notes/:id/transcript — 화자 이름 교정 (**주인만**)
// POST  /api/meeting-notes/:id/transcript — 붙여넣은 회의 내용을 전사로 넣는다 (**주인만**)
//
// **왜 지금 생기나.** 마이그 217 부터 전사가 DB 에 쌓이고 있었는데 읽는 화면이 없었다
// (`(member)/meeting-notes/` 전체에 문자열 `transcript` 0건, v0.7.588 실측).
// 녹음이 끝나도 사용자는 받아적은 내용을 볼 방법이 없었다.
//
// **왜 붙여넣기도 여기인가.** 예전에는 붙여넣기가 CRM API 로만 갔다. 그래서 회의노트는
// `withNote:true` 로 만들어졌는데도 **영원히 빈 껍데기**로 남았다 —
// "원본은 회의노트 하나"라는 원칙이 그 경로에서만 깨져 있었다.
// 이제 붙여넣기도 원본에 먼저 들어가고, CRM 은 발행으로 스냅샷을 받는다.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { listTranscriptSegments, distinctSpeakers } from '@/lib/meeting/transcript'
import { parseSpeakerLines } from '@/lib/meeting/paste-transcript'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/** 주인인가 — service_role 로 쓰기 전에 코드가 막는다(마이그 217: 쓰기는 전부 서버 경유) */
async function assertOwnNote(noteId: string, userId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('meeting_notes')
    .select('id')
    .eq('id', noteId).eq('user_id', userId).is('deleted_at', null)
    .maybeSingle()
  return Boolean(data?.id)
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  // 권한 판정은 RLS 가 한다(마이그 217: 부모 회의노트의 권한을 그대로 따름).
  // 여기서 다시 쓰면 규칙이 두 벌이 되고 한쪽만 고치는 날이 온다.
  const segments = await listTranscriptSegments(supabase, id)
  return NextResponse.json({ segments, speakers: distinctSpeakers(segments) })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  if (!await assertOwnNote(id, user.id)) {
    return NextResponse.json({ error: '이 회의노트는 작성한 사람만 고칠 수 있어요.' }, { status: 403 })
  }

  let body: { from?: unknown; to?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const from = typeof body.from === 'string' ? body.from : ''
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  if (!from) return NextResponse.json({ error: '바꿀 화자를 지정해 주세요.' }, { status: 400 })
  if (!to) return NextResponse.json({ error: '새 이름을 입력해 주세요.' }, { status: 400 })
  if (to.length > 40) return NextResponse.json({ error: '이름이 너무 깁니다.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: parts } = await admin
    .from('meeting_recording_part').select('id').eq('note_id', id)
  const partIds = ((parts ?? []) as { id: string }[]).map((p) => p.id)
  if (partIds.length === 0) return NextResponse.json({ ok: true, changed: 0 })

  const { data: updated, error } = await admin
    .from('meeting_transcript_segment')
    .update({ speaker: to })
    .in('part_id', partIds)
    .eq('speaker', from)
    .select('id')

  if (error) {
    return NextResponse.json({ error: `이름을 바꾸지 못했습니다: ${error.message}` }, { status: 500 })
  }

  // 평문 캐시도 같이 고친다 — 안 고치면 AI 입력만 옛 이름을 계속 읽는다
  await refreshPlainCache(admin, id, partIds)

  return NextResponse.json({ ok: true, changed: ((updated ?? []) as unknown[]).length })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  if (!await assertOwnNote(id, user.id)) {
    return NextResponse.json({ error: '이 회의노트는 작성한 사람만 고칠 수 있어요.' }, { status: 403 })
  }

  let body: { text?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim()) return NextResponse.json({ error: '회의 내용을 붙여넣어 주세요.' }, { status: 400 })
  if (text.length > 1_000_000) return NextResponse.json({ error: '내용이 너무 깁니다.' }, { status: 400 })

  const lines = parseSpeakerLines(text)
  if (lines.length === 0) return NextResponse.json({ error: '넣을 내용을 찾지 못했어요.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  /**
   * 붙여넣기는 **한 구간**으로 들어간다(오디오 없음).
   * 녹음 구간과 같은 표를 쓰는 이유: 세그먼트의 부모가 하나여야 정리 AI 가 근거를 댈 수 있다.
   * `part_idx` 는 기존 구간 뒤에 붙인다 — 녹음과 붙여넣기가 섞여도 시간축이 안 겹친다.
   */
  const { data: existing } = await admin
    .from('meeting_recording_part').select('part_idx').eq('note_id', id)
    .order('part_idx', { ascending: false }).limit(1)
  const nextIdx = (((existing ?? []) as { part_idx: number }[])[0]?.part_idx ?? -1) + 1

  const { data: part, error: partErr } = await admin
    .from('meeting_recording_part')
    .insert({
      note_id: id, part_idx: nextIdx, mime: 'text/plain',
      status: 'TRANSCRIBED', duration_sec: null,
    })
    .select('id').single()

  if (partErr || !part?.id) {
    return NextResponse.json({ error: '회의 내용을 넣지 못했습니다.' }, { status: 500 })
  }

  // 시각은 파서가 정한다(순서만 보존하는 자리표시) — 화면은 이 구간의 시각을 숨긴다
  const rows = lines.map((l) => ({
    part_id: part.id as string,
    idx: l.idx,
    speaker: l.speaker,
    start_ms: l.startMs,
    end_ms: l.endMs,
    text: l.text,
  }))

  const { error: segErr } = await admin.from('meeting_transcript_segment').insert(rows)
  if (segErr) {
    await admin.from('meeting_recording_part').delete().eq('id', part.id)
    return NextResponse.json({ error: `회의 내용을 넣지 못했습니다: ${segErr.message}` }, { status: 500 })
  }

  const { data: allParts } = await admin
    .from('meeting_recording_part').select('id').eq('note_id', id)
  await refreshPlainCache(admin, id, ((allParts ?? []) as { id: string }[]).map((p) => p.id))

  return NextResponse.json({ ok: true, segmentCount: rows.length })
}

/** `meeting_notes.transcript` 평문 캐시를 세그먼트에서 다시 만든다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function refreshPlainCache(admin: any, noteId: string, partIds: string[]): Promise<void> {
  if (partIds.length === 0) return
  const { data } = await admin
    .from('meeting_transcript_segment')
    .select('speaker, text, start_ms')
    .in('part_id', partIds)
    .order('start_ms', { ascending: true })
  const rows = (data ?? []) as { speaker: string; text: string }[]
  if (rows.length === 0) return
  const plain = rows.map((r) => `${r.speaker}: ${r.text}`).join('\n')
  await admin.from('meeting_notes').update({ transcript: plain }).eq('id', noteId)
}
