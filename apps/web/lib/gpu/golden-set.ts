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
    expect: [{ model: 'H100', memory: '80GB', price: 3650000 / 720 / 1370 }],   // ≈3.70
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
    expect: [{ model: 'H100', memory: '80GB', price: 4380000 / 720 / 1370 }],  // ≈4.44
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

// ── 재설계 4대 사고 회귀 fixture (확정 기획 P0 — golden-accidents.test.ts가 소비) ──

/** [사고A·D] 비-GPU 라벨(요금·서비스·메뉴명) → looksLikeGpuModel 반드시 false.
 *  소프트뱅크 GPU利用料金 오통과(v0.7.335)·비영어권 메뉴 오추출. */
export const NON_GPU_LABEL_FIXTURES: string[] = [
  'GPU利用料金（1枚あたり）', 'GPU 서버', 'GPU 이용요금',
  'モデルプラン', 'サービス', '月額基本料金', 'メインストレージ',   // 일본어
  '模型套餐', '服务', '月费', '登录服务器',                          // 중국어
  'خطة النموذج', 'خدمة',                                            // 아랍어
  '모델플랜', '서비스',                                             // 한국어
]

/** [사고B] 진짜 GPU 모델은 언어 무관·번들이어도 통과(유실 금지). */
export const GPU_LABEL_PASS_FIXTURES: string[] = [
  'H100', 'A100 80GB', 'NVIDIA DGX H100プラン', 'B200', 'GB200 β版プラン', '英伟达 H100', 'NVIDIA A100 時間貸しプラン',
]

/** [사고C] 다통화 관측 → per-GPU·1시간당 원화(정답). 엔100단위·번들8장·분당 사고 박제.
 *  fx=1통화당 KRW(정규화 완료). expectKrw=amount×fx÷시간÷장수. */
export const CURRENCY_OBS_FIXTURES: Array<{
  obs: { amount: number; currency: string; pricing_unit: 'minute' | 'hour' | 'day' | 'month' | 'year'; gpu_count: number }
  fx: Record<string, number>
  expectKrwPerGpuHour: number
}> = [
  { obs: { amount: 2_500_000, currency: 'JPY', pricing_unit: 'month', gpu_count: 8 }, fx: { JPY: 9.5 }, expectKrwPerGpuHour: (2_500_000 * 9.5) / 720 / 8 }, // 소프트뱅크 H100 번들
  { obs: { amount: 7.2, currency: 'JPY', pricing_unit: 'minute', gpu_count: 1 }, fx: { JPY: 9.5 }, expectKrwPerGpuHour: 7.2 * 9.5 * 60 },               // A100 시간제 분당
  { obs: { amount: 24, currency: 'USD', pricing_unit: 'hour', gpu_count: 8 }, fx: { USD: 1342.5 }, expectKrwPerGpuHour: (24 * 1342.5) / 8 },            // 8-GPU 노드 $24/hr
]

/** [사고E — v0.7.351 T4.1] 복합요금 무손실 회수 박제.
 *  소프트뱅크 A100 시간제는 3성분(기본료+분당 종량+스토리지)인데 재설계 전엔 1개만 저장되고 나머지는 폐기됐다.
 *  기본료는 GPU에 귀속 안 돼 looksLikeGpuModel 게이트에서 "GPU 아님"으로 사라지던 것이 근본 원인.
 *  → 라벨 자체는 여전히 모델이 아니지만(NON_GPU_LABEL_FIXTURES 유지), 직전 식별된 GPU 모델의
 *    요금성분으로 흡수돼야 한다. 성분 개수·종류가 줄면 회귀(= 다시 무음 손실). */
export const COMPONENT_RECOVERY_FIXTURES: Array<{
  label: string
  prose: string
  model: string
  expect: Array<{ component_kind: 'base_fee' | 'usage' | 'storage' | 'flat'; amount: number; currency: string; unit: string }>
}> = [
  {
    label: '소프트뱅크 A100 시간제 — 3성분 전량 회수(1개만 남고 2개 폐기되던 사고)',
    prose: 'NVIDIA A100 時間貸しプラン 月額基本料金 30,000円 GPU利用料金 7.2円/1分 メインストレージ 1,000円/100GB',
    model: 'A100',
    expect: [
      { component_kind: 'base_fee', amount: 30_000, currency: 'JPY', unit: 'month' },   // 月額 → 시간정보 보존(per_account로 뭉개면 손실)
      { component_kind: 'usage', amount: 7.2, currency: 'JPY', unit: 'minute' },
      { component_kind: 'storage', amount: 10, currency: 'JPY', unit: 'per_gb' },       // 1,000円/100GB → 1GB 단가 10(미정규화 시 100배 과대계상)
    ],
  },
]
