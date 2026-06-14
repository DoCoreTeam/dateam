// POST /api/pricing/gpu/gcube-reflected — gcube 홈페이지 "반영 완료" 수동 마킹 (단건/일괄)
//
// 의미: 전략가 확정('반영')과 별개로, 담당자가 실제 gcube.ai 홈페이지를 바꿨다고 박제하는 마킹.
//
// body: { product_ids: string[] }   // 단건도 배열 1개로 전달
//   각 product의 현재 strategic_price_krw(없으면 sell_price_krw 자동가)를
//   gcube_reflected_price_krw로 스냅샷, gcube_reflected_at=now(), gcube_reflected_by=actor 기록.
//
// 게이트: requireAdminApi (관리자 전용)
// 감사: recordGpuAudit(actionType:'gcube_reflected', detail={price_krw})
// 캐시: revalidateGpu()

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { revalidateGpu } from '@/lib/gpu/revalidate'

const MAX_IDS = 200

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const productIds = Array.isArray(body.product_ids)
    ? Array.from(
        new Set(
          (body.product_ids as unknown[]).filter(
            (x): x is string => typeof x === 'string' && x.trim().length > 0,
          ),
        ),
      )
    : []

  if (productIds.length === 0) {
    return NextResponse.json({ error: 'product_ids 필수 (선택된 항목이 없습니다)' }, { status: 400 })
  }
  if (productIds.length > MAX_IDS) {
    return NextResponse.json(
      { error: `한 번에 최대 ${MAX_IDS}건까지 처리할 수 있습니다` },
      { status: 400 },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const actor = auth.user.email ?? auth.user.id
  const nowIso = new Date().toISOString()

  // 대상 상품의 현재 전략가/자동가(sell_price_krw) 일괄 조회 — 반영 당시 스냅샷 산출(N+1 방지)
  const { data: products, error: fetchErr } = await db
    .from('gpu_products')
    .select('id, strategic_price_krw, sell_price_krw')
    .in('id', productIds)
    .is('deleted_at', null)

  if (fetchErr) {
    console.error('[gpu/gcube-reflected] fetch', fetchErr)
    return NextResponse.json({ error: '대상 조회에 실패했습니다' }, { status: 500 })
  }
  if (!products || products.length === 0) {
    return NextResponse.json({ error: '대상 상품을 찾을 수 없습니다' }, { status: 404 })
  }

  // 스냅샷 가격: strategic_price_krw 우선, 없으면 sell_price_krw(자동가). 둘 다 없으면 null.
  const snapshot = (p: { strategic_price_krw: number | null; sell_price_krw: number | null }): number | null => {
    const raw = p.strategic_price_krw ?? p.sell_price_krw
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? Math.round(n) : null
  }

  const results: { id: string; ok: boolean; price_krw: number | null }[] = []
  let marked = 0

  for (const p of products as { id: string; strategic_price_krw: number | null; sell_price_krw: number | null }[]) {
    const priceKrw = snapshot(p)
    const { error: updErr } = await db
      .from('gpu_products')
      .update({
        gcube_reflected_at: nowIso,
        gcube_reflected_by: actor,
        gcube_reflected_price_krw: priceKrw,
      })
      .eq('id', p.id)
      .is('deleted_at', null)

    if (updErr) {
      console.error('[gpu/gcube-reflected] update', p.id, updErr)
      results.push({ id: p.id, ok: false, price_krw: priceKrw })
      continue
    }

    marked++
    results.push({ id: p.id, ok: true, price_krw: priceKrw })
    await recordGpuAudit(db, {
      actor,
      actionType: 'gcube_reflected',
      productId: p.id,
      detail: { price_krw: priceKrw, reflected_at: nowIso },
    })
  }

  if (marked === 0) {
    return NextResponse.json({ error: '반영 완료 마킹에 실패했습니다' }, { status: 500 })
  }

  revalidateGpu()

  return NextResponse.json({ ok: true, marked, reflected_at: nowIso, results })
}
