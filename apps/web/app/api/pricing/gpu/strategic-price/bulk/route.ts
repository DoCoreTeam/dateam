// POST /api/pricing/gpu/strategic-price/bulk — 전략가 일괄 확정 (일괄 반영 리스트용, P3)
//
// body: { items: { product_id: string, strategic_price_krw: number }[] }
//   각 product의 strategic_price_krw를 일괄 설정한다.
//   추천가(candidate)는 콕핏 계산값이므로 서버에서 재계산하지 않고(계산식 불변 R1),
//   클라이언트가 표시 중인 추천가를 strategic_price_krw로 실어 보낸다(단순·안전).
//
// 게이트: requireAdminApi (관리자 전용)
// 감사: recordGpuAudit(actionType:'strategic_price_set') — 각 건. 단건 PATCH와 동일 의미.
// 캐시: revalidateGpu()

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { revalidateGpu } from '@/lib/gpu/revalidate'

const MAX_ITEMS = 200

interface BulkItem {
  product_id: string
  strategic_price_krw: number
}

/** body.items 정규화 — product_id(비어있지 않은 문자열) + 양수 정수 strategic_price_krw만 통과. */
function parseItems(raw: unknown): { items: BulkItem[]; invalid: boolean } {
  if (!Array.isArray(raw)) return { items: [], invalid: true }
  const seen = new Set<string>()
  const items: BulkItem[] = []
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) return { items: [], invalid: true }
    const obj = r as Record<string, unknown>
    const pid = typeof obj.product_id === 'string' ? obj.product_id.trim() : ''
    const n = Number(obj.strategic_price_krw)
    if (!pid || !Number.isFinite(n) || n <= 0) return { items: [], invalid: true }
    if (seen.has(pid)) continue // 중복 product_id는 첫 건만
    seen.add(pid)
    items.push({ product_id: pid, strategic_price_krw: Math.round(n) })
  }
  return { items, invalid: false }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const { items, invalid } = parseItems(body.items)
  if (invalid) {
    return NextResponse.json(
      { error: 'items는 { product_id, strategic_price_krw(양수) } 배열이어야 합니다' },
      { status: 400 },
    )
  }
  if (items.length === 0) {
    return NextResponse.json({ error: '선택된 항목이 없습니다' }, { status: 400 })
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `한 번에 최대 ${MAX_ITEMS}건까지 처리할 수 있습니다` },
      { status: 400 },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const actor = auth.user.email ?? auth.user.id
  const now = new Date().toISOString()

  // 변경 전 값 일괄 조회(감사 detail.before용, N+1 방지)
  const ids = items.map((it) => it.product_id)
  const { data: beforeRows, error: fetchErr } = await db
    .from('gpu_products')
    .select('id, strategic_price_krw, strategic_override_reason')
    .in('id', ids)
    .is('deleted_at', null)

  if (fetchErr) {
    console.error('[gpu/strategic-price/bulk] fetch', fetchErr)
    return NextResponse.json({ error: '대상 조회에 실패했습니다' }, { status: 500 })
  }

  const beforeMap = new Map<string, { strategic_price_krw: number | null; reason: string | null }>()
  for (const r of (beforeRows ?? []) as {
    id: string
    strategic_price_krw: number | null
    strategic_override_reason: string | null
  }[]) {
    beforeMap.set(r.id, {
      strategic_price_krw: r.strategic_price_krw,
      reason: r.strategic_override_reason,
    })
  }

  const reason = '추천가 일괄 반영'
  const results: { product_id: string; ok: boolean }[] = []
  let updated = 0

  for (const it of items) {
    // 존재하지 않는 product(beforeMap 미존재)는 건너뜀(404 누락 처리)
    if (!beforeMap.has(it.product_id)) {
      results.push({ product_id: it.product_id, ok: false })
      continue
    }

    const { error: updErr } = await db
      .from('gpu_products')
      .update({
        strategic_price_krw: it.strategic_price_krw,
        strategic_override_reason: reason,
        strategic_set_by: actor,
        strategic_set_at: now,
      })
      .eq('id', it.product_id)
      .is('deleted_at', null)

    if (updErr) {
      console.error('[gpu/strategic-price/bulk] update', it.product_id, updErr)
      results.push({ product_id: it.product_id, ok: false })
      continue
    }

    updated++
    results.push({ product_id: it.product_id, ok: true })

    const before = beforeMap.get(it.product_id) ?? { strategic_price_krw: null, reason: null }
    await recordGpuAudit(db, {
      actor,
      actionType: 'strategic_price_set',
      productId: it.product_id,
      detail: {
        before: { strategic_price_krw: before.strategic_price_krw, reason: before.reason },
        after: { strategic_price_krw: it.strategic_price_krw, reason },
        action: 'set',
        bulk: true,
      },
    })
  }

  if (updated === 0) {
    return NextResponse.json({ error: '전략가 일괄 확정에 실패했습니다' }, { status: 500 })
  }

  revalidateGpu()

  return NextResponse.json({ ok: true, updated, results })
}
