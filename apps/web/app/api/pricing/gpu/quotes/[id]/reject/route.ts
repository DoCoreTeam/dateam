import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { recordGpuAudit } from '@/lib/gpu/audit'

// POST /api/pricing/gpu/quotes/[id]/reject — 견적 반려(상태전이)
// 게이트: requireAdminApi (관리자 전용 — 임의 reject로 인한 가격책정 마비 방지)
// 쓰기: createAdminClient(service_role) — RLS 강화 후 user-client UPDATE는 거부되므로 admin client 필수
// 감사: recordGpuAudit SSOT (service_role 경유)
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any

    const { data: quote, error: fetchErr } = await db
      .from('supply_quotes')
      .select('product_id')
      .eq('id', params.id)
      .single()

    if (fetchErr || !quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    const { error } = await db
      .from('supply_quotes')
      .update({ status: 'rejected' })
      .eq('id', params.id)

    if (error) throw error

    await recordGpuAudit(db, {
      actor: auth.user.email ?? auth.user.id,
      actionType: 'rejected',
      productId: (quote as Record<string, unknown>).product_id as string,
      detail: { quote_id: params.id },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[quotes/reject]', err)
    return NextResponse.json({ error: 'Failed to reject quote' }, { status: 500 })
  }
}
