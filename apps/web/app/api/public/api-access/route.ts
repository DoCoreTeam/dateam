import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { throttlePublicRequest } from '@/lib/public-rate-limit'
import { z } from 'zod'

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  company: z.string().max(200).optional(),
  reason: z.string().min(10).max(1000),
})

/** 신청을 받았을 때 돌려주는 말 한 가지. 이미 있는 이메일이어도 같은 말을 한다. */
const ACCEPTED = {
  success: true,
  message: '신청이 접수되었습니다. 승인되면 관리자가 직접 연락드립니다.',
}

/**
 * API 사용 신청 — **로그인 없이 부를 수 있는 유일한 쓰기 창구다.**
 *
 * 그래서 둘을 지킨다.
 *   ① 속도 제한: 같은 곳에서 한 시간에 다섯 번까지 (마이그 260)
 *      없을 때는 아무나 몇 번이든 관리자 대기열에 행을 쌓을 수 있었다.
 *   ② 같은 대답: 이미 신청했거나 이미 승인된 이메일이어도 처음과 똑같이 답한다.
 *      전에는 409 로 «이미 승인된 계정입니다» 라고 알려 줬는데, 그러면 이메일 목록을
 *      들고 와서 누가 우리 고객인지 하나씩 확인할 수 있다.
 */
export async function POST(request: NextRequest) {
  try {
    const verdict = await throttlePublicRequest('api-access', request)
    if (!verdict.allowed) {
      return NextResponse.json(
        { success: false, error: `신청이 너무 잦습니다. ${verdict.retryAfterSeconds}초 후 다시 시도해 주세요.` },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
      )
    }

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: '입력값이 올바르지 않습니다', details: parsed.error.flatten() }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any

    // 이미 대기 중이거나 승인된 이메일이면 새로 쌓지 않는다 — 대답은 위와 같다
    const { data: existing } = await admin
      .from('api_access_requests')
      .select('id')
      .eq('email', parsed.data.email)
      .in('status', ['pending', 'approved'])
      .maybeSingle()

    if (existing) return NextResponse.json(ACCEPTED)

    const { error } = await admin
      .from('api_access_requests')
      .insert({
        email: parsed.data.email,
        name: parsed.data.name,
        company: parsed.data.company ?? null,
        reason: parsed.data.reason,
      })

    if (error) {
      console.error('[api-access POST]', error)
      return NextResponse.json({ success: false, error: '신청 처리 중 오류가 발생했습니다' }, { status: 500 })
    }

    // 메일 발송 장치가 아직 없다(의존성·코드 0건). 지킬 수 없는 약속을 하지 않는다.
    return NextResponse.json(ACCEPTED)
  } catch (err) {
    console.error('[api-access POST] unexpected', err)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
