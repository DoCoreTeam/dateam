import { describe, it, expect } from '../test-utils/vitest-compat.ts'
import { GOLDEN } from './golden-set.ts'
import { validateSupplierItem, validateCompetitorItem } from './validate.ts'
import { INTAKE_FIELD_MAP, resolveStatus } from './intake-routing-core.ts'

// 축8 골든셋 eval (#6) — 결정적 부분: bad 케이스는 검증 게이트가 100% 차단해야 한다.
// good 케이스(가격 환산 정확도)는 라이브 추출(Gemini) 필요 — 파이프라인 단위검증(별도)에서 커버.

describe('골든셋 — 게이트 차단(bad) 100%', () => {
  const bad = GOLDEN.filter((c): c is Extract<typeof c, { kind: 'bad' }> => c.kind === 'bad')

  it('bad 케이스가 존재한다', () => {
    expect(bad.length).toBeGreaterThanOrEqual(5)
  })

  for (const c of bad) {
    it(`[${c.name}] 게이트 차단됨`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = c.items as any[]
      const allBlocked = items.every((it) => {
        const r = c.type === 'supplier' ? validateSupplierItem(it) : validateCompetitorItem(it)
        return r.ok === false
      })
      expect(allBlocked).toBe(true)
    })
  }
})

describe('골든셋 — 재고 연계 라우팅(축2 회귀 가드)', () => {
  it('quantity → availability_responses 라우팅 계약 유지', () => {
    expect(INTAKE_FIELD_MAP.quantity).toBe('availability_responses')
  })
  it('재고 status 정규화가 DB enum과 일치', () => {
    expect(resolveStatus({ resp_qty: 10, is_total_capacity: true })).toBe('available_full')
    expect(resolveStatus({ resp_qty: 3 })).toBe('available_partial')
    expect(resolveStatus({ resp_qty: 0 })).toBe('out_of_stock')
    expect(['available_full', 'available_partial', 'out_of_stock', 'declined', 'pending'])
      .toContain(resolveStatus({ status: '미정' }))
  })
})
