import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/pricing/gpu/suppliers/bulk — 공급사 다중 일괄 삭제
//   body { action: 'delete', ids: uuid[] }
//   확정 견적이 연결된 공급사는 차단(단건 DELETE의 409 규칙을 일괄에도 적용) → blocked로 반환.
export async function POST(request: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  if (body.action !== 'delete') return NextResponse.json({ error: 'action은 delete만 지원' }, { status: 400 })
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : []
  if (ids.length === 0) return NextResponse.json({ error: '선택된 항목이 없습니다' }, { status: 400 })
  if (ids.length > 200) return NextResponse.json({ error: '한 번에 최대 200곳까지 삭제할 수 있습니다' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const actor = auth.user.email ?? auth.user.id

  // 확정 견적 연결 공급사 집계 → 차단 대상
  const { data: confirmed } = await db
    .from('supply_quotes').select('supplier_id').in('supplier_id', ids).eq('status', 'confirmed')
  const blockedCount = new Map<string, number>()
  for (const q of confirmed ?? []) {
    const sid = (q as { supplier_id: string }).supplier_id
    blockedCount.set(sid, (blockedCount.get(sid) ?? 0) + 1)
  }
  const deletable = ids.filter((id) => !blockedCount.has(id))
  const blocked = ids.filter((id) => blockedCount.has(id)).map((id) => ({ id, confirmed_quotes: blockedCount.get(id)! }))

  let deleted = 0
  if (deletable.length > 0) {
    const { data, error } = await db.from('suppliers').delete().in('id', deletable).select('id')
    if (error) {
      console.error('[suppliers bulk delete]', error)
      return NextResponse.json({ error: '일괄 삭제에 실패했습니다' }, { status: 500 })
    }
    deleted = (data ?? []).length
  }

  await recordGpuAudit(db, { actor, actionType: 'market_price_updated', detail: { op: 'supplier_bulk_deleted', deleted, blocked: blocked.length, ids: deletable } })
  revalidateGpu()
  return NextResponse.json({ ok: true, deleted, blocked })
}
