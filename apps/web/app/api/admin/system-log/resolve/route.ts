// POST /api/admin/system-log/resolve — 이 지문을 "처리함"으로 표시한다
//
// **사건이 아니라 상태다.** 다시 발생하면 새 사건이 쌓이고 목록에 되살아난다 —
// 처리했다고 영영 감추면 같은 장애가 재발했을 때 아무도 모른다(`AttentionBell` 과 같은 철학).

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: { message: '로그인이 필요합니다.' } }, { status: 401 })

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = admin as any
  const { data: profile } = await adm.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: { message: '관리자만 할 수 있습니다.' } }, { status: 403 })
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* 빈 것으로 본다 */ }
  const fingerprint = String(body.fingerprint ?? '').trim()
  if (!fingerprint) {
    return NextResponse.json({ error: { message: '어느 사건인지 알 수 없습니다.' } }, { status: 400 })
  }
  const undo = body.undo === true

  const { error } = await adm.from('system_events')
    .update({
      resolved_at: undo ? null : new Date().toISOString(),
      resolved_by: undo ? null : user.id,
    })
    .eq('fingerprint', fingerprint)
    // 되돌릴 때는 처리된 것만, 처리할 때는 안 된 것만 — 남의 표시를 덮지 않는다
    .filter('resolved_at', undo ? 'not.is' : 'is', undo ? null : null)

  if (error) return NextResponse.json({ error: { message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true })
}
