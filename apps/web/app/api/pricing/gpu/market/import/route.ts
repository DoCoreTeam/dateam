import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { saveCompetitorPrices, type CompetitorPriceItem } from '@/lib/gpu/competitor-import'
import { dedupCompetitor } from '@/lib/gpu/dedup'
import { partitionValid, validateCompetitorItem } from '@/lib/gpu/validate'
import { revalidateGpu } from '@/lib/gpu/revalidate'

// POST /api/pricing/gpu/market/import — AI 추출 경쟁가 '반영'.
//  2단계 승인게이트(v0.7.246): 제출=임직원(admin+member), 라이브 반영(market_prices)=admin.
//  member가 누르면 검토대기(review_items, target='competitor', pending)로 staging → admin이 검토대기에서
//  확정 시 confirm-review-item이 saveCompetitorPrices로 market 반영(제출↔확정 분리). 공급가 흐름과 동일 게이트.
//  body: { items: CompetitorPriceItem[], source_url?: string|null, is_test?: boolean }
export async function POST(req: NextRequest) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error

  let body: { items?: unknown; source_url?: unknown; is_test?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  // 검증 게이트(H1) — enum·범위 위반 격리 → 공용 dedup → 50건 상한. 전부 lib 재사용(SSOT).
  const raw = Array.isArray(body.items) ? (body.items as CompetitorPriceItem[]) : []
  const { passed, blocked } = partitionValid(raw, validateCompetitorItem)
  const items = dedupCompetitor(passed).slice(0, 50)
  if (items.length === 0) return NextResponse.json({ error: '반영 가능한 가격이 없습니다 (검증 차단)', blocked: blocked.map((b) => b.issues) }, { status: 400 })
  const sourceUrl = typeof body.source_url === 'string' ? body.source_url : null
  const isTest = body.is_test === true
  const adminClient = createAdminClient()

  // member(비admin) → 검토대기 staging (라이브 직접반영 차단). admin이 검토대기에서 확정해야 시장 반영됨.
  if (auth.user.role !== 'admin') {
    const batchId = crypto.randomUUID()
    const insertRows = items.map((it, idx) => ({
      source_batch_id: items.length > 1 ? batchId : null,
      batch_index: idx,
      target: 'competitor',
      product_hint: `${(it.model_name ?? '')} ${(it.memory ?? '')}`.trim() || null,
      supplier_hint: typeof it.competitor_name === 'string' ? it.competitor_name : null,
      channel: 'own',
      impact_level: 'steady',
      status: 'pending',
      current_iteration: 1,
      current_extracted: it,
      current_confidence: null,
      overall_confidence: null,
      is_test: isTest,
    }))
    // 092 RLS: review_items 쓰기는 service_role 전용 → adminClient
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error } = await (adminClient as any).from('review_items').insert(insertRows).select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ staged: true, count: inserted?.length ?? insertRows.length, blocked: blocked.length })
  }

  // admin → 라이브 반영(현행).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saved = await saveCompetitorPrices(adminClient as any, items, sourceUrl)
  if (saved.length === 0) return NextResponse.json({ error: '유효한 경쟁가가 없습니다' }, { status: 422 })
  revalidateGpu()
  return NextResponse.json({ saved, count: saved.length, staged: false, blocked: blocked.length })
}
