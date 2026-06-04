import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'

export async function GET() {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data, error } = await db
      .from('gpu_audit_logs')
      .select('*, gpu_products(model_name, memory, tier)')
      .order('ts', { ascending: false })
      .limit(300)

    if (error) throw error

    return NextResponse.json({ logs: data ?? [] })
  } catch (err) {
    console.error('[pricing/audit]', err)
    return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
  }
}

// DELETE /api/pricing/gpu/audit — 변동이력 일괄 삭제
//  body: { ids: string[], delete_data?: boolean }
//  delete_data=true면 로그가 참조하는 견적(detail.quote_id)도 함께 삭제(통합입력 배치 되돌리기).
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  let body: { ids?: unknown; delete_data?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : []
  if (ids.length === 0) return NextResponse.json({ error: '선택된 로그가 없습니다' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  let dataDeleted = 0
  if (body.delete_data) {
    const { data: logs } = await db.from('gpu_audit_logs').select('id, detail').in('id', ids)
    const quoteIds = Array.from(new Set((logs ?? [])
      .map((l: { detail: Record<string, unknown> | null }) => l.detail?.quote_id as string | undefined)
      .filter((q: string | undefined): q is string => !!q)))
    if (quoteIds.length > 0) {
      const { count } = await db.from('supply_quotes').delete({ count: 'exact' }).in('id', quoteIds)
      dataDeleted = count ?? 0
    }
  }

  const { error } = await db.from('gpu_audit_logs').delete().in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateGpu()
  return NextResponse.json({ ok: true, logs_deleted: ids.length, data_deleted: dataDeleted })
}
