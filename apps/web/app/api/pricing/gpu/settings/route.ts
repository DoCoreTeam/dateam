import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'

export async function GET() {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const [settingsRes, fxRes] = await Promise.all([
      db.from('pricing_settings').select('*').eq('id', 1).single(),
      db.from('fx_rates').select('*').order('rate_date', { ascending: false }).limit(1).single(),
    ])

    return NextResponse.json({
      margin_pct: settingsRes.data?.margin_pct ?? 18,
      usd_krw: fxRes.data?.usd_krw ?? null,
      fx_date: fxRes.data?.rate_date ?? null,
    })
  } catch (err) {
    console.error('[pricing/settings]', err)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const margin_pct = Number(body.margin_pct)
  if (!Number.isFinite(margin_pct) || margin_pct < 0 || margin_pct > 999) {
    return NextResponse.json({ error: 'margin_pct는 0~999 범위여야 합니다' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const actor = auth.user.email ?? auth.user.id

  const { data, error } = await db
    .from('pricing_settings')
    .upsert({ id: 1, margin_pct, updated_by: actor, updated_at: new Date().toISOString() })
    .select()
    .single()

  if (error) {
    console.error('[pricing/settings PATCH]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  await recordGpuAudit(db, {
    actor,
    actionType: 'margin_changed',
    detail: { margin_pct },
  })

  // 마진 변경은 sell_price 전체에 영향 → 4탭 캐시 무효화 (stale 방지)
  revalidateGpu()

  return NextResponse.json({ margin_pct: data.margin_pct })
}
