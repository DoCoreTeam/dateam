// 자가검증 골든셋 (H3) — 정합성·신뢰도 회귀 평가용 고정 입력·정답. 드리프트 감시·릴리즈 게이트에 재사용.
// good: 추출 결과가 expect와 일치해야 함. bad: 검증 게이트가 반드시 차단해야 함.

export interface GoldenGood {
  name: string
  kind: 'good'
  text: string
  expect: Array<{ model: string; memory?: string; price: number; term?: number | string }>
}
export interface GoldenBad {
  name: string
  kind: 'bad'              // 검증 게이트가 차단해야 하는 항목(commit/import에 보내면 422)
  type: 'supplier' | 'competitor'
  items: unknown[]
}
export type GoldenCase = GoldenGood | GoldenBad

export const GOLDEN: GoldenCase[] = [
  // ── 정답 추출(good) ──
  {
    name: '공급가-단건-환산', kind: 'good',
    text: 'GMI Cloud H100 80GB SXM 월 3,650,000원 (월정액)',
    expect: [{ model: 'H100', memory: '80GB', price: 3650000 / 730 / 1370 }],   // ≈3.65
  },
  {
    name: '공급가-배치-약어', kind: 'good',
    text: 'GMI 공급견적: h100sxm 80g $2.10/hr 3개월, A100 40GB $1.50 온디맨드, L40S 48g $0.95/hr',
    expect: [
      { model: 'H100', memory: '80GB', price: 2.1 },
      { model: 'A100', memory: '40GB', price: 1.5 },
      { model: 'L40S', memory: '48GB', price: 0.95 },
    ],
  },
  {
    name: '경쟁사-환율', kind: 'good',
    text: 'NAVER Cloud H100 80GB 인스턴스 월 4,380,000원 reserved',
    expect: [{ model: 'H100', memory: '80GB', price: 4380000 / 730 / 1370 }],  // ≈4.38
  },

  // ── 게이트 차단(bad) ──
  {
    name: '공급가-모델명없음', kind: 'bad', type: 'supplier',
    items: [{ extracted: { model_name: '', memory: '80GB', unit_price_usd: 2.1 } }],
  },
  {
    name: '공급가-음수가격', kind: 'bad', type: 'supplier',
    items: [{ extracted: { model_name: 'H100', unit_price_usd: -5 } }],
  },
  {
    name: '공급가-tier위반', kind: 'bad', type: 'supplier',
    items: [{ extracted: { model_name: 'H100', unit_price_usd: 2, tier_suggestion: 9 } }],
  },
  {
    name: '경쟁사-pricing_model위반', kind: 'bad', type: 'competitor',
    items: [{ competitor_name: 'RunPod', model_name: 'H100', price_usd: 2.99, pricing_model: 'monthly' }],
  },
  {
    name: '경쟁사-가격없음', kind: 'bad', type: 'competitor',
    items: [{ competitor_name: 'RunPod', model_name: 'H100' }],
  },
]

// 가격 근사 비교 허용오차(환산 반올림 흡수)
export const PRICE_TOLERANCE = 0.05
