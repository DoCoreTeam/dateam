import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { promoteCompetitorToSupplier } from '@/lib/gpu/promote-supplier'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/pricing/gpu/competitors/bulk — 다중 선택 일괄 처리
//   body { action: 'delete' | 'promote', ids: uuid[] }
export async function POST(request: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const action = body.action
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : []
  if (ids.length === 0) return NextResponse.json({ error: '선택된 항목이 없습니다' }, { status: 400 })
  if (ids.length > 200) return NextResponse.json({ error: '한 번에 최대 200곳까지 처리할 수 있습니다' }, { status: 400 })
  if (action !== 'delete' && action !== 'promote') return NextResponse.json({ error: 'action은 delete 또는 promote' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const actor = auth.user.email ?? auth.user.id

  if (action === 'delete') {
    // 일괄 소프트 삭제
    const nowIso = new Date().toISOString()
    const { data, error } = await db
      .from('competitors')
      .update({ deleted_at: nowIso, is_active: false, updated_at: nowIso })
      .in('id', ids)
      .is('deleted_at', null)
      .select('id')
    if (error) {
      console.error('[gpu/competitors bulk delete]', error)
      return NextResponse.json({ error: '일괄 삭제에 실패했습니다' }, { status: 500 })
    }
    const deleted = (data ?? []).length
    await recordGpuAudit(db, { actor, actionType: 'market_price_updated', detail: { op: 'competitor_bulk_deleted', count: deleted, ids } })
    revalidateGpu()
    return NextResponse.json({ ok: true, deleted })
  }

  // action === 'promote' — 일괄 공급사 지정
  let promoted = 0, failed = 0
  const results: { id: string; ok: boolean; error?: string }[] = []
  for (const id of ids) {
    const r = await promoteCompetitorToSupplier(db, id, auth.user.id, actor)
    if (r.ok) promoted++; else failed++
    results.push({ id, ok: r.ok, error: r.error })
  }
  revalidateGpu()
  return NextResponse.json({ ok: true, promoted, failed, results })
}
