/**
 * POST /api/meeting-notes/:id/ask — 이 회의에 묻는다.
 *
 * 로그인한 사람이 **볼 수 있는** 노트에만 답한다. 못 보는 노트와 없는 노트는 같은 404 다
 * (있는지 없는지를 대답으로 알려 주지 않는다).
 * 막힌 이유는 사람이 알아들을 말로만 돌려준다 — 모델 이름과 시도 목록은 싣지 않는다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiCallError } from '@/lib/ai/gemini-call'
import { BudgetDeniedError } from '@/lib/ai/budget'
import { parseAskQuestion } from '@/lib/meeting/ask'
import { AskError, runMeetingAsk } from '@/lib/meeting/ask-run'

export const runtime = 'nodejs'
export const maxDuration = 180

type Ctx = { params: Promise<{ id: string }> }

const ASK_ERROR_STATUS = { not_found: 404, empty: 400, no_key: 503 } as const

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = parseAskQuestion(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 400 })

  try {
    const answer = await runMeetingAsk({ supabase, noteId: id, userId: auth.user.id, question: parsed.question })
    return NextResponse.json(answer)
  } catch (e) {
    if (e instanceof AskError) {
      return NextResponse.json({ error: e.message, reason: e.code }, { status: ASK_ERROR_STATUS[e.code] })
    }
    if (e instanceof BudgetDeniedError) {
      return NextResponse.json({ error: e.userMessage, reason: 'budget', retryAt: e.retryAtIso }, { status: 429 })
    }
    if (e instanceof GeminiCallError) {
      const status = e.reason === 'quota' ? 429 : 502
      return NextResponse.json({ error: e.userMessage, reason: e.reason }, { status })
    }
    console.error('[meeting-ask]', id, e instanceof Error ? e.message : e)
    return NextResponse.json({ error: '답을 받지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
