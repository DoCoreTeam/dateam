// GET   /api/rfp/notifications — 안 읽은 알림
// PATCH /api/rfp/notifications — 읽음 표시
//
// 알림은 **자기 것만** 보인다. 같은 조직이라도 남의 알림을 읽을 이유가 없다
// (RLS 정책도 같은 판단을 한다 — 마이그 248).

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { NOTIFY_KINDS } from '@/lib/rfp/notify/notify'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const db = await createClient()
  const { data, error } = await (db as any)
    .from('rfp_notifications')
    .select('id, kind, title, body, link, created_at')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: '알림을 불러오지 못했습니다' }, { status: 500 })
  return NextResponse.json({ notifications: data ?? [], kinds: NOTIFY_KINDS })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let body: { ids?: unknown; all?: unknown }
  try {
    body = (await req.json()) as { ids?: unknown; all?: unknown }
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const db = await createClient()
  const now = new Date().toISOString()

  if (body.all === true) {
    const { error } = await (db as any)
      .from('rfp_notifications')
      .update({ read_at: now })
      .is('read_at', null)
      .eq('user_id', gate.user.id)
    if (error) return NextResponse.json({ error: '읽음 표시에 실패했습니다' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : []
  if (ids.length === 0) return NextResponse.json({ error: 'missing_ids' }, { status: 400 })

  const { error } = await (db as any)
    .from('rfp_notifications')
    .update({ read_at: now })
    .in('id', ids)
    .eq('user_id', gate.user.id)

  if (error) return NextResponse.json({ error: '읽음 표시에 실패했습니다' }, { status: 500 })
  return NextResponse.json({ ok: true, count: ids.length })
}
