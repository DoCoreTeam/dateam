/**
 * GET /api/pricing/gpu/gcube-check
 *
 * 콕핏 표시용: product별 gcube 가격 비교 최신 상태 반환.
 * gpu_products 캐시 컬럼(gcube_last_*)을 우선 읽고,
 * 캐시가 없는 product는 gcube_price_checks 최신 행으로 보완.
 *
 * 응답: GcubeCheckItem[]
 *
 * NOTE (B3 — 수동 트리거):
 *   POST로 서버에서 파서를 직접 트리거하는 엔드포인트는 구현하지 않음.
 *   이유: Playwright(Chromium) 바이너리가 Vercel 서버리스 함수 이미지에 포함되지 않으며,
 *         /tmp 기반 Chromium 번들 트릭도 500MB 제한으로 실용적이지 않음.
 *         → 파서는 로컬 또는 GitHub Actions에서만 실행할 것을 권고.
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'

export interface GcubeCheckItem {
  product_id: string
  model_name: string
  gpu_count: number
  status: 'match' | 'mismatch' | 'not_found' | 'our_unset' | null
  gcube_low_krw: number | null
  gcube_high_krw: number | null
  our_price_krw: number | null
  checked_at: string | null
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const supabase = await createClient()

  // 인증 가드 — anon 차단
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
  }

  try {
    const adminDb = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = adminDb as any

    // ── 1. gpu_products 캐시 컬럼 + strategic_price_krw 조회 ──────────────────
    const { data: products, error: productErr } = await db
      .from('gpu_products')
      .select(
        'id, model_name, gpu_count, strategic_price_krw, gcube_last_status, gcube_last_checked_at, gcube_last_low_krw, gcube_last_high_krw'
      )
      .is('deleted_at', null)
      .order('model_name', { ascending: true })
      .order('gpu_count', { ascending: true })

    if (productErr) {
      throw new Error(`gpu_products 조회 실패: ${productErr.message}`)
    }

    // ── 2. 캐시 없는 product ID 목록 → gcube_price_checks 최신 행으로 보완 ──
    const uncachedIds: string[] = (products as Array<{ id: string; gcube_last_checked_at: string | null }>)
      .filter((p) => p.gcube_last_checked_at === null)
      .map((p) => p.id)

    // product_id별 최신 check 행 (DISTINCT ON)
    const fallbackMap = new Map<
      string,
      { status: string; gcube_low_krw: number; gcube_high_krw: number; our_price_krw: number | null; checked_at: string }
    >()

    if (uncachedIds.length > 0) {
      // Supabase는 DISTINCT ON 미지원 → 최신 checked_at DESC, limit per product 불가
      // 방법: uncachedIds별로 각 1행 조회 (N개이지만 uncached는 초기 상태라 소수)
      // 최적화: 전체 in() 조회 후 메모리 그룹핑
      const { data: checks, error: checkErr } = await db
        .from('gcube_price_checks')
        .select('product_id, status, gcube_low_krw, gcube_high_krw, our_price_krw, checked_at')
        .in('product_id', uncachedIds)
        .order('checked_at', { ascending: false })

      if (!checkErr && checks) {
        for (const row of checks as Array<{
          product_id: string
          status: string
          gcube_low_krw: number
          gcube_high_krw: number
          our_price_krw: number | null
          checked_at: string
        }>) {
          // 첫 번째 행(가장 최신)만 보관 (이미 DESC 정렬됨)
          if (!fallbackMap.has(row.product_id)) {
            fallbackMap.set(row.product_id, {
              status: row.status,
              gcube_low_krw: row.gcube_low_krw,
              gcube_high_krw: row.gcube_high_krw,
              our_price_krw: row.our_price_krw,
              checked_at: row.checked_at,
            })
          }
        }
      }
    }

    // ── 3. 응답 조립 ──────────────────────────────────────────────────────────
    const items: GcubeCheckItem[] = (
      products as Array<{
        id: string
        model_name: string
        gpu_count: number
        strategic_price_krw: number | null
        gcube_last_status: string | null
        gcube_last_checked_at: string | null
        gcube_last_low_krw: number | null
        gcube_last_high_krw: number | null
      }>
    ).map((p) => {
      // 캐시 컬럼 우선 사용
      if (p.gcube_last_checked_at !== null) {
        return {
          product_id: p.id,
          model_name: p.model_name,
          gpu_count: p.gpu_count,
          status: (p.gcube_last_status as GcubeCheckItem['status']) ?? null,
          gcube_low_krw: p.gcube_last_low_krw,
          gcube_high_krw: p.gcube_last_high_krw,
          our_price_krw: p.strategic_price_krw,
          checked_at: p.gcube_last_checked_at,
        }
      }

      // 캐시 없음 → gcube_price_checks 최신 행 fallback
      const fb = fallbackMap.get(p.id)
      if (fb) {
        return {
          product_id: p.id,
          model_name: p.model_name,
          gpu_count: p.gpu_count,
          status: (fb.status as GcubeCheckItem['status']) ?? null,
          gcube_low_krw: fb.gcube_low_krw,
          gcube_high_krw: fb.gcube_high_krw,
          our_price_krw: p.strategic_price_krw,
          checked_at: fb.checked_at,
        }
      }

      // 체크 이력 없음
      return {
        product_id: p.id,
        model_name: p.model_name,
        gpu_count: p.gpu_count,
        status: null,
        gcube_low_krw: null,
        gcube_high_krw: null,
        our_price_krw: p.strategic_price_krw,
        checked_at: null,
      }
    })

    return NextResponse.json({ items })
  } catch (err) {
    console.error('[pricing/gcube-check GET]', err)
    return NextResponse.json({ error: '조회 실패' }, { status: 500 })
  }
}
