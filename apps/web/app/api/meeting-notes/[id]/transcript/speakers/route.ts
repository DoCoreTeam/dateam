// POST /api/meeting-notes/:id/transcript/speakers — 말차례로 화자 나누기 (**주인만**)
//
// **왜 생겼나**(사용자 지적 v0.7.686): *"화자 분리가 아니라 그냥 한문장 씩 분석 한거 같고"*
// 맞는 지적이었다 — 화자 분리는 만든 적이 없고, DB 실측으로 406/409줄이 문자열 「화자」였다.
//
// **왜 목소리로 안 하나.** 지금 쓰는 whisper-large-v3(Groq)는 화자 분리를 주지 않는다.
// 붙이려면 비용과 처리 시간이 늘어난다. 그래서 무료로 가능한 길을 골랐다(사용자 승인 ⓒ):
// 말이 끊긴 자리로 **말차례**를 나누고(순수 계산), 그 위에서 AI 가 말투·호칭으로 묶는다.
//
// **되돌릴 수 있다.** 이미 사람이 이름을 붙여 둔 구간은 건드리지 않고,
// 모르는 차례도 손대지 않는다 — 「화자」로 남는다. 다시 눌러도 같은 일만 한다(멱등).
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { listTranscriptSegments, segmentsToPlain } from '@/lib/meeting/transcript'
import {
  groupTurns, buildSpeakerPrompt, parseSpeakerAssignment, assignSpeakers, UNSPLIT_SPEAKER,
} from '@/lib/meeting/speaker-split'
import { callGeminiJson } from '@/lib/ai/gemini-call'
import { DEFAULT_GEMINI_MODEL } from '@/lib/ai/gemini-model'

export const runtime = 'nodejs'
export const maxDuration = 120

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id: noteId } = await ctx.params
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: note } = await admin
    .from('meeting_notes')
    .select('id, attendees')
    .eq('id', noteId).eq('user_id', auth.user.id).is('deleted_at', null)
    .maybeSingle()
  // 남의 노트의 화자를 바꾸는 것은 그 사람의 기록을 고치는 일이다 — 주인만 할 수 있다
  if (!note?.id) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })

  const segments = await listTranscriptSegments(supabase, noteId)
  /*
    아직 안 나눈 구간만 대상이다. 사람이 이미 이름을 붙여 둔 것을 AI 가 덮으면
    **사람의 판단을 기계가 뒤집는 것**이라, 그건 되돌리기가 아니라 손실이다.
  */
  const target = segments.filter((s) => s.speaker === UNSPLIT_SPEAKER)
  if (target.length === 0) {
    return NextResponse.json({ ok: true, changed: 0, notice: '나눌 구간이 없어요. 이미 화자가 지정돼 있습니다.' })
  }

  const turns = groupTurns(target.map((s) => ({ id: s.id, startMs: s.startMs, endMs: s.endMs, text: s.text })))
  if (turns.length < 2) {
    return NextResponse.json({ ok: true, changed: 0, notice: '말이 끊긴 자리가 없어 나눌 수 없어요.' })
  }

  const { data: metaRow } = await admin.from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  if (!apiKey) return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다.' }, { status: 503 })

  const attendees = String(note.attendees ?? '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean)

  let raw: unknown
  try {
    const res = await callGeminiJson({
      prompt: buildSpeakerPrompt(turns, attendees),
      apiKey,
      model: (typeof meta.gemini_model === 'string' ? meta.gemini_model : '') || DEFAULT_GEMINI_MODEL,
      feature: 'meeting-speaker-split',
      temperature: 0,
      timeoutMs: 60_000,
      overallTimeoutMs: 100_000,
      maxOutputTokens: 8_192,
    })
    raw = res.value
  } catch {
    // 실패해도 전사는 그대로다 — 사용자가 잃는 것이 없다
    return NextResponse.json({ error: '화자를 나누지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 502 })
  }

  const assignment = parseSpeakerAssignment(raw, turns.length)
  const byId = assignSpeakers(turns, assignment)
  if (byId.size === 0) {
    return NextResponse.json({ ok: true, changed: 0, notice: '누가 말했는지 확신할 수 없어 그대로 두었어요.' })
  }

  /*
    같은 이름끼리 묶어 한 번에 쓴다 — 구간 수만큼 UPDATE 를 날리면 406건이면 406번이다.
    쓰기는 언제나 서버 경유다(마이그 217).
  */
  const groups = new Map<string, string[]>()
  for (const [segId, name] of Array.from(byId)) {
    const arr = groups.get(name) ?? []
    arr.push(segId)
    groups.set(name, arr)
  }
  let changed = 0
  for (const [name, ids] of Array.from(groups)) {
    const { data } = await admin
      .from('meeting_transcript_segment')
      .update({ speaker: name })
      .in('id', ids)
      .select('id')
    changed += ((data ?? []) as unknown[]).length
  }

  // 평문 사본도 함께 고친다 — 안 고치면 내보내기·CRM 스냅샷이 옛 이름을 말한다
  const after = await listTranscriptSegments(supabase, noteId)
  await admin.from('meeting_notes').update({ transcript: segmentsToPlain(after) }).eq('id', noteId)

  const people = new Set(Array.from(byId.values())).size
  return NextResponse.json({
    ok: true, changed,
    notice: `${people}명으로 나눴어요. 이름이 다르면 화자를 눌러 고쳐 주세요.`,
  })
}
