import { describe, it, expect } from '../test-utils/vitest-compat.ts'
import { validateSupplierItem, validateCompetitorItem, gateFromConfidence, partitionValid, ENUMS } from './validate.ts'

describe('validateSupplierItem — 게이트 차단 증명', () => {
  it('정상 항목 통과', () => {
    const r = validateSupplierItem({ extracted: { model_name: 'H100 SXM', memory: '80GB', unit_price_usd: 2.1, tier_suggestion: 1 } })
    expect(r.ok).toBe(true)
    expect(r.issues.filter((i) => i.severity === 'block')).toHaveLength(0)
  })
  it('모델명 없으면 차단', () => {
    expect(validateSupplierItem({ extracted: { model_name: '', unit_price_usd: 2 } }).ok).toBe(false)
  })
  it('가격 없음/0/음수/불가능치 차단', () => {
    expect(validateSupplierItem({ extracted: { model_name: 'A100', unit_price_usd: 0 } }).ok).toBe(false)
    expect(validateSupplierItem({ extracted: { model_name: 'A100', unit_price_usd: -1 } }).ok).toBe(false)
    expect(validateSupplierItem({ extracted: { model_name: 'A100', unit_price_usd: 99999 } }).ok).toBe(false)
    expect(validateSupplierItem({ extracted: { model_name: 'A100' } }).ok).toBe(false)
  })
  it('tier enum 위반 차단', () => {
    expect(validateSupplierItem({ extracted: { model_name: 'A100', unit_price_usd: 2, tier_suggestion: 5 } }).ok).toBe(false)
  })
  it('이상치(밴드 밖)는 경고만 — 차단 아님', () => {
    const r = validateSupplierItem({ extracted: { model_name: 'H100', unit_price_usd: 0.31, tier_suggestion: 1 } }) // tier1 밴드 0.3~80, 0.31 통과지만 경계
    expect(r.ok).toBe(true)
    const r2 = validateSupplierItem({ extracted: { model_name: 'H100', unit_price_usd: 0.05, tier_suggestion: 1 } }) // tier1인데 $0.05 → 밴드 밖
    expect(r2.ok).toBe(true) // 차단 아님
    expect(r2.issues.some((i) => i.severity === 'warn')).toBe(true) // 경고는 있음
  })
})

describe('validateCompetitorItem — 게이트 차단', () => {
  it('정상 통과', () => {
    expect(validateCompetitorItem({ competitor_name: 'RunPod', model_name: 'H100', price_usd: 2.99, pricing_model: 'on_demand' }).ok).toBe(true)
  })
  it('pricing_model enum 위반 차단', () => {
    expect(validateCompetitorItem({ competitor_name: 'RunPod', model_name: 'H100', price_usd: 2.99, pricing_model: 'monthly' }).ok).toBe(false)
  })
  it('하이픈 표기는 정규화 후 통과 (on-demand→on_demand)', () => {
    expect(validateCompetitorItem({ competitor_name: 'X', model_name: 'H100', price_usd: 1, pricing_model: 'on-demand' }).ok).toBe(true)
  })
  it('경쟁사명/모델명/가격 없으면 차단', () => {
    expect(validateCompetitorItem({ model_name: 'H100', price_usd: 1 }).ok).toBe(false)
    expect(validateCompetitorItem({ competitor_name: 'X', price_usd: 1 }).ok).toBe(false)
    expect(validateCompetitorItem({ competitor_name: 'X', model_name: 'H100' }).ok).toBe(false)
  })
})

describe('gateFromConfidence — H2 신뢰도 게이팅', () => {
  it('≥90 auto / 60~89 review / <60 low', () => {
    expect(gateFromConfidence({ a: 95, b: 92 })).toBe('auto')
    expect(gateFromConfidence({ a: 70 })).toBe('review')
    expect(gateFromConfidence({ a: 40 })).toBe('low')
    expect(gateFromConfidence(null)).toBe('none')
  })
})

describe('partitionValid — 격리(차단분리)', () => {
  it('나쁜 항목만 격리, 정상은 통과', () => {
    const items = [
      { extracted: { model_name: 'H100', unit_price_usd: 2.1, tier_suggestion: 1 } },  // ok
      { extracted: { model_name: '', unit_price_usd: 2 } },                              // block
      { extracted: { model_name: 'A100', unit_price_usd: -5 } },                         // block
    ]
    const { passed, blocked } = partitionValid(items, validateSupplierItem)
    expect(passed).toHaveLength(1)
    expect(blocked).toHaveLength(2)
  })
})

describe('ENUMS SSOT 존재', () => {
  it('핵심 enum 정의', () => {
    expect(ENUMS.pricing_model).toContain('on_demand')
    expect(ENUMS.tier).toEqual([1, 2, 3])
  })
})
