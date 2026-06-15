import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

// POST /api/pricing/gpu/review/bulk — 검토대기 항목 일괄 처리.
//  body: { ids: string[], action: 'delete' }
//  delete = review_items 영구 삭제(review_iterations는 FK ON DELETE CASCADE). 가격DB(market_prices 등)에는 영향 없음
//  — 미확정(pending) 검토대기 행만 정리하는 용도이므로 시세/원가는 건드리지 않는다.
const MAX_BULK = 500

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const user = auth.user

  let body: { ids?: unknown; action?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, MAX_BULK)
    : []
  const action = typeof body.action === 'string' ? body.action : ''
  if (ids.length === 0) return NextResponse.json({ error: '선택된 항목이 없습니다' }, { status: 400 })
  if (action !== 'delete') return NextResponse.json({ error: 'action은 delete만 지원합니다' }, { status: 400 })

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient as any)
    .from('review_items').delete().in('id', ids).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const deleted = (data ?? []) as Array<{ id: string }>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any).from('gpu_audit_logs').insert({
    actor: user.email ?? user.id,
    action_type: 'review_bulk_deleted',
    detail: { count: deleted.length, requested: ids.length },
  }).then(undefined, () => {})

  return NextResponse.json({ ok: true, deleted: deleted.length })
}
