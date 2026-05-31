import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { z } from 'zod'

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  company: z.string().max(200).optional(),
  reason: z.string().min(10).max(1000),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: '입력값이 올바르지 않습니다', details: parsed.error.flatten() }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any

    // 중복 이메일 pending/approved 확인
    const { data: existing } = await admin
      .from('api_access_requests')
      .select('id, status')
      .eq('email', parsed.data.email)
      .in('status', ['pending', 'approved'])
      .maybeSingle()

    if (existing) {
      if (existing.status === 'approved') {
        return NextResponse.json({ success: false, error: '이미 승인된 계정입니다. 로그인해주세요.' }, { status: 409 })
      }
      return NextResponse.json({ success: false, error: '이미 신청된 이메일입니다. 승인 대기 중입니다.' }, { status: 409 })
    }

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

    return NextResponse.json({ success: true, message: '신청이 완료되었습니다. 승인 후 이메일로 안내드립니다.' })
  } catch (err) {
    console.error('[api-access POST] unexpected', err)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
