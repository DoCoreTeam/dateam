// POST /api/meeting-notes/:id/digest — 메모 + 녹음 전사를 함께 읽어 정리한다 (**주인만**)
// GET  /api/meeting-notes/:id/digest — 정리본 이력 (읽기 권한은 RLS 가 판정)
//
// 타이밍 계약(D7): **전사는 자동, 정리는 버튼.** 여기는 버튼이 부르는 자리다.
// 자동으로 안 도는 이유 셋 — ① 사용자가 전사를 먼저 고칠 수 있어야 결과가 맞다
// ② 60분 회의는 입력이 5~7만 토큰이라 비싸다 ③ 지시.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runMeetingDigest, listMeetingDigests } from '@/lib/meeting/digest-run'
import { GeminiCallError } from '@/lib/ai/gemini-call'

export const runtime = 'nodejs'
// 구간이 여럿이면 AI 를 여러 번 부른다. 기본 상한으로는 60분 회의에서 잘린다.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  // 읽기 권한은 RLS 가 정한다(마이그 221: 부모 회의노트의 권한을 그대로 따름)
  const versions = await listMeetingDigests(supabase, id)
  return NextResponse.json({ versions })
}

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  try {
    // 소유 확인은 runMeetingDigest 안의 `.eq('user_id')` 가 한다 —
    // 못 찾으면 "찾을 수 없습니다"로 떨어지고, 남의 회의를 정리하지 못한다
    const out = await runMeetingDigest(id, user.id)
    return NextResponse.json({
      ok: true,
      seq: out.seq,
      digest: out.digest,
      sources: out.sources,
      legacy: out.legacy,
      notice: out.notice,
    })
  } catch (e) {
    // AI 실패는 사람이 읽을 수 있는 말로 나간다 — 조용히 500 만 던지면 사용자는 이유를 모른다
    if (e instanceof GeminiCallError) {
      return NextResponse.json({ error: e.message, attempts: e.attempts }, { status: 502 })
    }
    const msg = e instanceof Error ? e.message : '정리하지 못했습니다.'
    const notFound = msg.includes('찾을 수 없습니다')
    return NextResponse.json({ error: msg }, { status: notFound ? 404 : 500 })
  }
}
