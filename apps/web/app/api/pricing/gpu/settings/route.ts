import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidateGpu } from '@/lib/gpu/revalidate'

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
  try {
    // 인증은 유저 클라이언트로 확인, 쓰기는 service_role(admin) 클라이언트로 수행
    // (pricing_settings 쓰기 RLS가 service_role 전용 — 일반 유저 클라이언트로는 차단되어 저장이 유지되지 않음)
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any

    const body = await request.json()
    const margin_pct = Number(body.margin_pct)
    if (isNaN(margin_pct) || margin_pct < 0 || margin_pct > 999) {
      return NextResponse.json({ error: 'Invalid margin_pct' }, { status: 400 })
    }

    const { data, error } = await db
      .from('pricing_settings')
      .upsert({ id: 1, margin_pct, updated_by: user.email, updated_at: new Date().toISOString() })
      .select()
      .single()

    if (error) throw error

    await db.from('gpu_audit_logs').insert({
      action_type: 'margin_changed',
      actor: user.email,
      detail: { margin_pct },
    })

    // 마진 변경은 sell_price 전체에 영향 → 4탭 캐시 무효화 (stale 방지)
    revalidateGpu()

    return NextResponse.json({ margin_pct: data.margin_pct })
  } catch (err) {
    console.error('[pricing/settings PATCH]', err)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
