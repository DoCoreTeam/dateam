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

// ── 실제 실패 fixture (회귀 코퍼스) ──
//  취합파일(타겟금액_csp…konsttech)에서 실측한 진짜 문제 shape를 영구 고정.
//  loop1-5에서 고친 결정론 레이어(canonical·validate·format)가 다시 깨지지 않게 가드.
//  ⚠️ 새 실패 업로드를 만나면 여기에 fixture를 추가해 회귀를 박제할 것(텔레메트리가 공급원).

/** 모델명 정규화 회귀 — 메모리 토큰 뒤 trailing 부호/공백이 카탈로그 매칭을 깨던 사고(F1). */
export const MODEL_KEY_FIXTURES: Array<{ raw: string; sameAs: string }> = [
  { raw: 'H200 141GB.', sameAs: 'H200' },     // 실파일의 마침표(B122 'H200 141GB.')
  { raw: 'H100 80GB ', sameAs: 'H100' },       // trailing 공백(C114)
  { raw: 'H200 141GB.', sameAs: 'H200 141GB' },
  { raw: 'B300 288GB)', sameAs: 'B300' },
  { raw: 'NVIDIA HGX B200', sameAs: 'B200' },
]

/** 무가격/문의 셀(실파일의 X·확인중·Custom·소량 확인중) — 숫자 아님 → 가격검증 차단 대상. */
export const NON_NUMERIC_PRICE_CELLS: string[] = ['X', '확인중', 'Custom', '소량 확인중', '문의']

/** USD 표시 정밀도 회귀 — KRW÷FX÷시간이 만든 무한소수(실파일 J열) → ceil 3자리. */
export const USD_FORMAT_FIXTURES: Array<{ v: number; expect: string }> = [
  { v: 0.81018518518, expect: '$0.811' }, // T4 시간당 USD(J37)
  { v: 0.92592592592, expect: '$0.926' }, // V100(J38)
  { v: 2.7546296296, expect: '$2.755' },  // H100(J40)
  { v: 3.24, expect: '$3.24' },
  { v: 1234.5, expect: '$1,234.50' },
]
