import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

// GET /api/pricing/gpu/sources — "수집 소스" 관제 화면 데이터.
//   DB에 흩어져 저장된 경쟁사 가격 소스 링크(경쟁사 페이지 URL + 모델별 URL)를
//   한 목록으로 합쳐 보여준다. (설계 헌법 제10조 수집자동화의 관제 화면)
export async function GET() {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  const [{ data: comps }, { data: maps }, { data: lastRun }] = await Promise.all([
    db.from('competitors').select('id, name, pricing_url, is_active').is('deleted_at', null),
    db.from('competitor_product_mapping')
      .select('id, competitor_url, is_active, competitor_id, competitors!competitor_id(name), gpu_products!gpu_product_id(model_name)')
      .not('competitor_url', 'is', null),
    db.from('market_refresh_runs').select('run_date, status, finished_at, urls_checked, prices_updated').order('run_date', { ascending: false }).limit(1).maybeSingle(),
  ])

  type Source = {
    id: string
    kind: 'competitor_page' | 'model_url'
    target: string
    url: string
    active: boolean
    competitorId: string
  }
  const sources: Source[] = []

  for (const c of (comps ?? [])) {
    if (typeof c.pricing_url === 'string' && c.pricing_url.trim()) {
      sources.push({ id: `comp:${c.id}`, kind: 'competitor_page', target: c.name ?? '(이름 없음)', url: c.pricing_url, active: c.is_active !== false, competitorId: c.id })
    }
  }
  for (const m of (maps ?? [])) {
    const url = typeof m.competitor_url === 'string' ? m.competitor_url : ''
    if (!url.trim()) continue
    const comp = m.competitors?.name ?? '(경쟁사 미상)'
    const model = m.gpu_products?.model_name ?? '(모델 미연결)'
    sources.push({ id: `map:${m.id}`, kind: 'model_url', target: `${comp} · ${model}`, url, active: m.is_active !== false, competitorId: m.competitor_id })
  }

  return NextResponse.json({ sources, lastRun: lastRun ?? null })
}
