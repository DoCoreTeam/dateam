import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

// GET /api/admin/data-quality/drilldown?metric=anomaly|low_confidence|pending|dup_suspects
// 지표 카드 클릭 시 "어떤 항목이 왜" 상세 목록 반환 (관리자 전용). 지표→진단 연결.
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const metric = new URL(req.url).searchParams.get('metric') ?? ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  if (metric === 'anomaly') {
    // 확정 견적 중 가격 밴드 밖 — 모델·tier·가격·밴드 사유 (review/[id] 아닌 supply_quotes)
    const { data } = await db.rpc('get_anomaly_quotes')
    return NextResponse.json({ metric, items: data ?? [] })
  }
  if (metric === 'low_confidence') {
    const { data } = await db.from('review_items')
      .select('id, product_hint, supplier_hint, overall_confidence, status, channel')
      .eq('is_test', false).not('overall_confidence', 'is', null).lt('overall_confidence', 60)
      .order('overall_confidence', { ascending: true }).limit(100)
    return NextResponse.json({ metric, items: data ?? [] })
  }
  if (metric === 'pending') {
    const { data } = await db.from('review_items')
      .select('id, product_hint, supplier_hint, overall_confidence, impact_level, created_at')
      .eq('is_test', false).eq('status', 'pending').order('created_at', { ascending: true }).limit(100)
    return NextResponse.json({ metric, items: data ?? [] })
  }
  if (metric === 'dup_suspects') {
    const { data } = await db.rpc('get_dup_suspects')
    return NextResponse.json({ metric, items: data ?? [] })
  }
  return NextResponse.json({ error: 'unknown metric' }, { status: 400 })
}
