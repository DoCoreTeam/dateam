import { describe, it, expect, vi, beforeEach } from 'vitest'

// recordAvailability(재고 SSOT writer) 재사용을 검증 — 실제 DB 없이 라우팅 계약만 확인
const recordAvailability = vi.fn(async () => ({ ok: true as const, record: {} }))
vi.mock('./repository', () => ({ recordAvailability: (...a: unknown[]) => recordAvailability(...a) }))

import { INTAKE_FIELD_MAP, unmappedFields, routeAvailability } from './intake-routing'

// 축4 계약게이트: 통합입력 추출 필드는 전부 저장 대상이 선언돼야 한다(없으면 = 증발 위험).
// 이 테스트가 "추출하는데 저장 안 되는" 사고(재고 증발 같은)를 코드리뷰 전에 차단한다.

// 통합입력 active 프롬프트(gpu.quote-extract v2.0)가 산출하는 정규 필드 집합.
// 프롬프트가 새 필드를 뽑기 시작하면 여기에 추가 → 매핑 없으면 아래 테스트가 FAIL.
const EXTRACT_FIELDS = [
  'model_name', 'memory', 'unit_price_usd', 'original_price', 'original_currency',
  'original_unit', 'term', 'term_months', 'min_qty', 'valid_until', 'gpu_count',
  'supplier', 'tier_suggestion', 'tier_reason', 'quantity', 'has_quantity_info',
]

describe('축4 계약게이트 — 추출 필드 ↔ 저장 대상', () => {
  it('모든 추출 필드가 INTAKE_FIELD_MAP에 저장대상을 가진다(증발 0)', () => {
    expect(unmappedFields(EXTRACT_FIELDS)).toEqual([])
  })

  it('재고(quantity)는 availability_responses로 라우팅된다(증발 버그 회귀 가드)', () => {
    expect(INTAKE_FIELD_MAP.quantity).toBe('availability_responses')
  })

  it('매핑 없는 신규 필드는 게이트가 잡아낸다(차단 증명)', () => {
    const drift = unmappedFields([...EXTRACT_FIELDS, 'new_unmapped_field'])
    expect(drift).toContain('new_unmapped_field')
    expect(drift.length).toBe(1)
  })
})

describe('축2/3 재고 자동반영 라우팅', () => {
  const ctx = { db: {}, adminDb: {}, productId: 'p1', supplierId: 's1', actor: 'tester', isTest: true }
  beforeEach(() => recordAvailability.mockClear())

  it('quantity.resp_qty 있으면 recordAvailability(재고 SSOT)로 반영', async () => {
    const r = await routeAvailability(ctx, { resp_qty: 8, is_total_capacity: false })
    expect(r.status).toBe('written')
    expect(recordAvailability).toHaveBeenCalledTimes(1)
    const arg = recordAvailability.mock.calls[0][2] as Record<string, unknown>
    expect(arg.productId).toBe('p1')
    expect(arg.respQty).toBe(8)
    expect(arg.status).toBe('available_partial')
  })

  it('is_total_capacity=true면 available_full', async () => {
    await routeAvailability(ctx, { resp_qty: 100, is_total_capacity: true })
    expect((recordAvailability.mock.calls[0][2] as Record<string, unknown>).status).toBe('available_full')
  })

  it('out_of_stock_explicit는 status=out_of_stock로 반영', async () => {
    const r = await routeAvailability(ctx, { out_of_stock_explicit: true })
    expect(r.status).toBe('written')
    expect((recordAvailability.mock.calls[0][2] as Record<string, unknown>).status).toBe('out_of_stock')
  })

  it('재고 신호 없으면 skip(부분커밋 — 가격은 살림)', async () => {
    const r = await routeAvailability(ctx, {})
    expect(r.status).toBe('skipped')
    expect(recordAvailability).not.toHaveBeenCalled()
  })

  it('quantity 자체가 없으면 skip', async () => {
    const r = await routeAvailability(ctx, undefined)
    expect(r.status).toBe('skipped')
  })
})
