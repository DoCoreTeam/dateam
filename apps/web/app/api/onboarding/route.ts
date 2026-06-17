import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * 온보딩 진행 상태 영속화.
 *
 * 본인 profiles 행만 갱신(RLS — createClient는 사용자 세션 기준이라 다른 사람 행을 못 건드림).
 * 입력은 셋 중 하나만:
 *   { step: string }    → onboarding_step 갱신(재개 지점)
 *   { completed: true } → onboarding_completed_at = now()
 *   { skipped: true }   → onboarding_skipped_at = now()
 *
 * 컬럼은 마이그레이션 113(BE 담당)에서 추가: onboarding_completed_at / onboarding_step / onboarding_skipped_at.
 */

const STEP_MAX = 64

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문' }, { status: 400 })
  }

  const patch = buildPatch(body)
  if (!patch) return NextResponse.json({ error: '유효하지 않은 입력' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('profiles')
    .update(patch)
    .eq('id', user.id)

  if (error) {
    // 내부 메시지(컬럼/제약 등) 노출 방지 — 상세는 서버 로그로만 (DC-SEC LOW-1)
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[onboarding] state persist failed', error.message)
    }
    return NextResponse.json({ error: '온보딩 상태 저장 실패' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

interface ProfilePatch {
  onboarding_step?: string
  onboarding_completed_at?: string
  onboarding_skipped_at?: string
}

function buildPatch(body: unknown): ProfilePatch | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>

  if (typeof b.step === 'string') {
    const step = b.step.trim()
    if (!step || step.length > STEP_MAX) return null
    return { onboarding_step: step }
  }
  if (b.completed === true) {
    return { onboarding_completed_at: new Date().toISOString() }
  }
  if (b.skipped === true) {
    return { onboarding_skipped_at: new Date().toISOString() }
  }
  return null
}
