/**
 * 원가·견적 라인 용어 (SSOT) — 기획 「원가에서 견적까지」 §03·§08
 *
 * **왜 표준 원가회계 분류를 쓰나**: 우리가 갈래를 지어내면 회계·세무와 말이 안 통한다.
 * 「우리 회사 식 분류」는 결산할 때 다시 매핑해야 하고, 그 매핑은 아무도 유지하지 않는다.
 *
 * **원가는 대외비다.** 여기 있는 말은 고객에게 나가는 문서(`lib/terms/quote.ts`)와 섞지 않는다 —
 * 섞이면 내보내기에서 어느 쪽 말인지 판단을 화면이 하게 되고, 그때부터 샌다.
 */

// ------------------------------------------------------------
// 견적 라인 종류 여섯
// ------------------------------------------------------------

export type QuoteLineKind = 'USAGE' | 'QUANTITY' | 'EFFORT' | 'LICENSE' | 'PERIOD' | 'RATIO'

export const LINE_KIND_LABEL: Record<QuoteLineKind, string> = {
  USAGE: '사용량',
  QUANTITY: '수량',
  EFFORT: '공수',
  LICENSE: '라이선스',
  PERIOD: '기간요금',
  RATIO: '비율',
}

/** 화면이 세우는 순서 — 자주 쓰는 것부터 */
export const LINE_KIND_ORDER: readonly QuoteLineKind[] =
  ['QUANTITY', 'EFFORT', 'PERIOD', 'USAGE', 'LICENSE', 'RATIO']

/** 종류마다 「수량」 칸이 뜻하는 것이 다르다 — 라벨이 같으면 사람이 잘못 넣는다 */
export const LINE_KIND_QUANTITY_LABEL: Record<QuoteLineKind, string> = {
  USAGE: '사용량',
  QUANTITY: '수량',
  EFFORT: 'M/M',
  LICENSE: '사용자 수',
  PERIOD: '개월',
  RATIO: '—',
}

/** 종류마다 단가의 뜻도 다르다 */
export const LINE_KIND_PRICE_LABEL: Record<QuoteLineKind, string> = {
  USAGE: '시간당 단가',
  QUANTITY: '단가',
  EFFORT: 'M/M 단가',
  LICENSE: '사용자당 단가',
  PERIOD: '월 단가',
  RATIO: '—',
}

/** 기본 단위 — 사람이 매번 치지 않게 */
export const LINE_KIND_UNIT: Record<QuoteLineKind, string> = {
  USAGE: 'h',
  QUANTITY: '식',
  EFFORT: 'M/M',
  LICENSE: 'User',
  PERIOD: '개월',
  RATIO: '%',
}

/** 무엇을 넣는 종류인지 한 줄 설명 — 고르는 순간 보인다 */
export const LINE_KIND_HINT: Record<QuoteLineKind, string> = {
  USAGE: 'GPU 시간처럼 쓴 만큼 청구하는 항목',
  QUANTITY: '개수 × 단가. 장비·라이선스 매입처럼 셀 수 있는 것',
  EFFORT: '역할과 등급을 정하고 공수(M/M)를 곱합니다. SI·개발 인력',
  LICENSE: '사용자 수 × 단가. 기간이 붙으면 기간요금과 함께 씁니다',
  PERIOD: '월 단가 × 개월. 운영·유지보수처럼 기간으로 파는 것',
  RATIO: '다른 항목의 몇 %. 관리비·기술지원료처럼 붙는 것',
}

/** 공수 라인에만 있는 칸 */
export const EFFORT_ROLE_LABEL = '역할'
export const EFFORT_GRADE_LABEL = '등급'
export const EFFORT_ROLE_HINT = '예: 소프트웨어 엔지니어 · UI/UX 디자이너 · PM'

// ------------------------------------------------------------
// 원가 갈래 열 — 대분류는 **파생한다**(표에 두면 둘이 어긋난다)
// ------------------------------------------------------------

export type CostCategory =
  | 'MATERIAL' | 'LABOR' | 'EXPENSE'
  | 'SUBCONTRACT' | 'PARTNER_FEE'
  | 'OVERHEAD' | 'INFRA'
  | 'FINANCE' | 'WARRANTY' | 'CONTINGENCY'

export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  MATERIAL: '재료비',
  LABOR: '노무비',
  EXPENSE: '경비',
  SUBCONTRACT: '하도급',
  PARTNER_FEE: '파트너 수수료',
  OVERHEAD: '일반관리비',
  INFRA: '공통 인프라',
  FINANCE: '금융비용',
  WARRANTY: '하자보수 충당',
  CONTINGENCY: '예비비',
}

/** 대분류 — 갈래에서 계산한다. 표에 따로 저장하면 둘이 어긋난다 */
export type CostGroup = 'DIRECT' | 'SUBCONTRACT' | 'INDIRECT' | 'RISK'

export const COST_GROUP_LABEL: Record<CostGroup, string> = {
  DIRECT: '직접비',
  SUBCONTRACT: '외주비',
  INDIRECT: '간접비',
  RISK: '기간·위험',
}

export const COST_GROUP_HINT: Record<CostGroup, string> = {
  DIRECT: '이 사업에만 쓴 돈',
  SUBCONTRACT: '밖에 맡긴 몫',
  INDIRECT: '여러 사업이 나눠 쓰는 돈',
  RISK: '나중에 나가는 돈 — 지금 안 세면 마진이 실제보다 높게 보인다',
}

const GROUP_OF: Record<CostCategory, CostGroup> = {
  MATERIAL: 'DIRECT', LABOR: 'DIRECT', EXPENSE: 'DIRECT',
  SUBCONTRACT: 'SUBCONTRACT', PARTNER_FEE: 'SUBCONTRACT',
  OVERHEAD: 'INDIRECT', INFRA: 'INDIRECT',
  FINANCE: 'RISK', WARRANTY: 'RISK', CONTINGENCY: 'RISK',
}

export function costGroupOf(category: CostCategory): CostGroup {
  return GROUP_OF[category]
}

/** 화면 순서 — 대분류 묶음대로 */
export const COST_CATEGORY_ORDER: readonly CostCategory[] = [
  'MATERIAL', 'LABOR', 'EXPENSE',
  'SUBCONTRACT', 'PARTNER_FEE',
  'OVERHEAD', 'INFRA',
  'FINANCE', 'WARRANTY', 'CONTINGENCY',
]

/** 갈래마다 무엇을 적는지 — 「경비」가 뭔지 몰라서 안 적는 일이 없게 */
export const COST_CATEGORY_HINT: Record<CostCategory, string> = {
  MATERIAL: 'GPU 매입 · 서버·스위치 소싱 · 라이선스 매입 · 외부 제품',
  LABOR: 'SI 투입 인력 · PM · 개발 · 상주 엔지니어',
  EXPENSE: '출장 · 설치 · 운반 · 검사 · 회선 · 시험환경',
  SUBCONTRACT: '구축·개발 외주',
  PARTNER_FEE: '파트너 인센티브. 나중에 나가지만 원가다',
  OVERHEAD: '사무실·관리 인력. 통상 매출의 일정 %',
  INFRA: '공용 서버·모니터링·라이선스 풀',
  FINANCE: '선매입 후 후불 수금 사이의 자금 비용',
  WARRANTY: '「검수 후 1년 무상」 — 무상이지만 원가는 든다',
  CONTINGENCY: '환율·물가·범위 변경 대비',
}

// ------------------------------------------------------------
// 원가 시점 셋
// ------------------------------------------------------------

export type CostStage = 'ESTIMATE' | 'COMMITTED' | 'ACTUAL'

export const COST_STAGE_LABEL: Record<CostStage, string> = {
  ESTIMATE: '추정',
  COMMITTED: '확정',
  ACTUAL: '실적',
}

/**
 * 넣는 방식 — **같은 금액도 «어떻게 나온 숫자인지»가 다르다.**
 * 금액만 남기면 나중에 「이 3,600만원이 어디서 나왔지」를 아무도 모른다.
 */
export const COST_INPUT_MODE_LABEL: Record<CostInputMode, string> = {
  AMOUNT: '금액으로',
  EFFORT: '공수 × 단가',
  RATIO: '비율로',
}

export const COST_INPUT_MODE_ORDER: readonly CostInputMode[] = ['AMOUNT', 'EFFORT', 'RATIO']

export const COST_INPUT_MODE_HINT: Record<CostInputMode, string> = {
  AMOUNT: '금액을 그대로 적습니다. 견적서·계약서에 적힌 값이 있을 때',
  EFFORT: '공수(M/M)에 등급 단가를 곱합니다. 인건비가 대부분 이렇습니다',
  RATIO: '매출이나 원가 합계의 몇 %로 잡습니다. 관리비·예비비가 그렇습니다',
}

export const COST_STAGE_ORDER: readonly CostStage[] = ['ESTIMATE', 'COMMITTED', 'ACTUAL']

export const COST_STAGE_HINT: Record<CostStage, string> = {
  ESTIMATE: '견적 시점에 잡은 원가. 틀려도 되지만 근거를 남깁니다',
  COMMITTED: '계약 시점에 매입 견적서·계약서로 고정한 원가',
  ACTUAL: '실제 나간 돈. 추정과의 차이가 다음 견적의 정확도가 됩니다',
}

// ------------------------------------------------------------
// 입력 방식 셋
// ------------------------------------------------------------

export type CostInputMode = 'AMOUNT' | 'EFFORT' | 'RATIO'

export const COST_INPUT_LABEL: Record<CostInputMode, string> = {
  AMOUNT: '금액',
  EFFORT: '공수(M/M)',
  RATIO: '비율(%)',
}

export const COST_INPUT_ORDER: readonly CostInputMode[] = ['AMOUNT', 'EFFORT', 'RATIO']

/** 비율의 기준 */
export type RatioBase = 'REVENUE' | 'COST'
export const RATIO_BASE_LABEL: Record<RatioBase, string> = {
  REVENUE: '매출의',
  COST: '원가의',
}

// ------------------------------------------------------------
// 마진 — 화면이 쓰는 말
// ------------------------------------------------------------

export const COST = {
  section: '원가·마진',
  /** 원가 탭 옆에 붙는 표시 — 이 탭은 내보내기에 안 실린다 */
  internalOnly: '대외비 — 내보내는 파일에 담기지 않습니다',
  totalCost: '원가 합계',
  grossProfit: '매출총이익',
  marginPct: '마진율',
  addCost: '원가 항목 추가',
  emptyTitle: '원가가 아직 없어요',
  emptyHint: '원가를 적으면 이 딜이 남는 장사인지 바로 보입니다. 견적이 없어도 됩니다.',
  gradeSection: '인건비 등급',
  gradeEmpty: '등급이 아직 없어요',
  gradeHint: '등급을 만들어 두면 공수 항목에서 골라 쓸 수 있습니다.',
  costPerMm: 'M/M 원가',
  pricePerMm: 'M/M 제시가',
  effortMm: '공수(M/M)',
  basisNote: '근거',
  basisHint: '왜 이 금액인지 — 정산 서류에 그대로 쓰입니다',
} as const

/** 원가가 비었을 때 견적을 보내려 하면 — **막지는 않는다**(기획 §09 ①) */
export const COST_MISSING_WARN =
  '원가가 아직 없어 마진을 계산할 수 없어요. 그대로 보내도 되지만, 남는 장사인지는 알 수 없습니다.'

/** 마진율은 표시용이다 — 계산에는 안 쓴다(기획 §05) */
export function formatMarginPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—'
  return `${pct.toFixed(1)}%`
}
