import { describe, it, expect } from '../test-utils/vitest-compat.ts'
import { dedupSupplier, dedupCompetitor } from './dedup.ts'

describe('dedupSupplier', () => {
  it('동일 모델+메모리+가격+약정 중복 제거', () => {
    const items = [
      { extracted: { model_name: 'RTX 6000 Ada', memory: '48GB', unit_price_usd: 0.65, term_months: 3 } },
      { extracted: { model_name: 'RTX 6000 Ada', memory: '48GB', unit_price_usd: 0.65, term_months: 3 } }, // 중복
      { extracted: { model_name: 'RTX 6000 Ada', memory: '48GB', unit_price_usd: 0.62, term_months: 6 } }, // 약정 다름 → 유지
    ]
    expect(dedupSupplier(items)).toHaveLength(2)
  })

  it('표기 흔들림(대소문자·공백) 흡수', () => {
    const items = [
      { extracted: { model_name: 'H100 SXM', memory: '80GB', unit_price_usd: 2.1, term_months: 3 } },
      { extracted: { model_name: 'h100  sxm', memory: '80 GB', unit_price_usd: 2.1, term_months: 3 } }, // 같은 항목
    ]
    expect(dedupSupplier(items)).toHaveLength(1)
  })

  it('price_usd/unit_price_usd 필드명 혼용도 동일 취급', () => {
    const items = [
      { extracted: { model_name: 'A100', memory: '40GB', unit_price_usd: 1.5, term: '온디맨드' } },
      { extracted: { model_name: 'A100', memory: '40GB', price_usd: 1.5, term: '온디맨드' } },
    ]
    expect(dedupSupplier(items)).toHaveLength(1)
  })

  it('약정 표기 혼용(3 vs "3개월") 동일 취급', () => {
    const items = [
      { extracted: { model_name: 'H100', memory: '80GB', unit_price_usd: 2.1, term_months: 3 } },
      { extracted: { model_name: 'H100', memory: '80GB', unit_price_usd: 2.1, term: '3개월' } },
    ]
    expect(dedupSupplier(items)).toHaveLength(1)
  })

  it('부동소수 흔들림(1.5 vs 1.5000001) 흡수', () => {
    const items = [
      { extracted: { model_name: 'A100', memory: '80GB', unit_price_usd: 1.5, term_months: 1 } },
      { extracted: { model_name: 'A100', memory: '80 GB', unit_price_usd: 1.5000001, term_months: 1 } },
    ]
    expect(dedupSupplier(items)).toHaveLength(1)
  })

  it('모델명 없는(식별 불가) 항목은 보존', () => {
    const items = [
      { extracted: { model_name: '', memory: '48GB' } },
      { extracted: { model_name: '', memory: '48GB' } },
    ]
    expect(dedupSupplier(items)).toHaveLength(2)
  })
})

describe('dedupCompetitor', () => {
  it('동일 경쟁사+모델+메모리+가격+약정모델 중복 제거', () => {
    const items = [
      { competitor_name: 'RunPod', model_name: 'H100', memory: '80GB', price_usd: 2.99, pricing_model: 'on_demand' },
      { competitor_name: 'runpod', model_name: 'H100', memory: '80GB', price_usd: 2.99, pricing_model: 'on_demand' }, // 중복
      { competitor_name: 'RunPod', model_name: 'H100', memory: '80GB', price_usd: 2.49, pricing_model: 'reserved_1y' }, // 약정 다름 → 유지
    ]
    expect(dedupCompetitor(items)).toHaveLength(2)
  })
})
