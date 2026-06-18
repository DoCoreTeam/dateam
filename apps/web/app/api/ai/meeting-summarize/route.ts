import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { summarizeMeeting } from '@/lib/gemini-meeting'
import { htmlToPlain } from '@/lib/html-to-plain'

// 회의노트 AI 요약(생성형): POST { meetingNoteId } → { success, data:{ summary, decisions } }
// 권한: 본인 노트만(RLS + 명시 조건). bodyPlain 없으면 body_html→plain 변환.
// apiKey/model: org_content META(SSOT, 하드코딩 금지) — suggest-dept-tasks 라우트와 동일 소스.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: '인증이 필요합니다.' }, { status: 401 })

  let body: { meetingNoteId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: '요청 형식 오류' }, { status: 400 })
  }
  const meetingNoteId = body.meetingNoteId
  if (!meetingNoteId || typeof meetingNoteId !== 'string') {
    return NextResponse.json({ success: false, error: '회의노트 ID가 필요합니다.' }, { status: 400 })
  }

  // 노트 조회 + 권한(본인 행만) — RLS가 1차, 명시 user_id가 2차 방어
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: note } = await (supabase.from('meeting_notes') as any)
    .select('body_plain, body_html')
    .eq('id', meetingNoteId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!note) {
    return NextResponse.json({ success: false, error: '회의노트를 찾을 수 없습니다.' }, { status: 404 })
  }

  const bodyPlain = (note.body_plain as string | null)?.trim() || htmlToPlain(note.body_html as string | null)
  if (!bodyPlain.trim()) {
    return NextResponse.json({ success: false, error: '요약할 본문이 없습니다.' }, { status: 400 })
  }

  // API 키 (org_content META)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: metaRow } = await admin.from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = (typeof meta.gemini_model === 'string' ? meta.gemini_model : '') || 'gemini-2.0-flash'
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'Gemini API 키가 설정되지 않았습니다.' }, { status: 400 })
  }

  try {
    const { summary, decisions } = await summarizeMeeting({ userId: user.id, bodyPlain, apiKey, model })
    return NextResponse.json(
      { success: true, data: { summary, decisions } },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    console.error('[meeting-summarize]', e)
    return NextResponse.json({ success: false, error: '회의 요약에 실패했습니다. 다시 시도해 주세요.' }, { status: 500 })
  }
}
