/**
 * 이상 조항 규칙 12종 (설계서 3.8.1)
 *
 * ## 왜 규칙이 먼저인가
 *
 * 「이 공고는 특정 업체용 같다」는 판단은 **법적 위험이 있는 말**이다.
 * 모델이 그런 문장을 만들면 우리는 그것을 검증할 수 없다.
 * 규칙은 다르다 — 「공고 기간이 20일인데 협상계약 기준은 40일이다」는 **숫자로 확인된다.**
 *
 * ## 이 파일에는 «판정 방법» 만 있다
 *
 * 규칙 값(임계 배수, 사전 목록, 노임단가)은 조직마다 다르고 해마다 바뀐다.
 * 그래서 **DB(`rfp_anomaly_rules`)가 진실**이고 여기는 기본값과 실행 방법만 둔다.
 * 코드에 박으면 관리자가 못 고치고, 못 고치면 규칙이 곧 낡는다.
 */

export type RuleId =
  | 'R01' | 'R02' | 'R03' | 'R04' | 'R05' | 'R06'
  | 'R07' | 'R08' | 'R09' | 'R10' | 'R11' | 'R12'

/** 어떤 방법으로 판정하나 */
export type RuleMethod = 'regex' | 'numeric' | 'dictionary' | 'regex_dictionary' | 'regex_numeric'

/** 확정인가 의심인가 — 「확정」도 위법 단정이 아니라 «숫자가 그렇다» 는 뜻이다 */
export type AnomalyGrade = 'confirmed' | 'suspected'

/** 무엇을 위협하나 (설계서 3.8) */
export type AnomalySeverity = 'blocking' | 'margin' | 'contract' | 'competition'

export interface AnomalyRule {
  id: RuleId
  title: string
  method: RuleMethod
  grade: AnomalyGrade
  severity: AnomalySeverity
  /** 관리자가 고치는 값들. DB 의 params 칸에 그대로 들어간다 */
  params: Record<string, unknown>
  enabled: boolean
}

/**
 * 기본 규칙 12종.
 *
 * 이 배열은 **시드값**이다. 실행기는 DB 에서 읽은 규칙을 쓰고,
 * DB 가 비었을 때만 이것으로 채운다.
 */
export const DEFAULT_RULES: readonly AnomalyRule[] = [
  {
    id: 'R01', title: '특정 상표 명시', method: 'regex_dictionary',
    grade: 'confirmed', severity: 'competition',
    params: {
      // 「동등 이상」이 함께 있으면 상표를 적어도 문제가 아니다
      equivalencePhrases: ['동등 이상', '또는 동등', '이상의 성능', '동등 사양', '이와 동등'],
      brandDictionary: ['오라클', 'Oracle', 'MS SQL', 'SAP', 'VMware', 'Cisco', 'NVIDIA', 'AWS', 'Azure'],
      /** 몇 문장 안까지 「동등 이상」을 찾아볼까 */
      windowSentences: 2,
    },
    enabled: true,
  },
  {
    id: 'R02', title: '고유 규격 수치', method: 'regex',
    grade: 'suspected', severity: 'competition',
    params: {
      // 특정 제품에서만 나오는 수치 조합이 한 문장에 몇 개 이상 모이면 의심한다
      minSpecTokens: 3,
      specPattern: '(\\d+\\s?(GB|TB|GHz|Gbps|nm|W)\\b)|(NVLink|InfiniBand|PCIe\\s?\\d)',
    },
    enabled: true,
  },
  {
    id: 'R03', title: '법정 공고 기간', method: 'numeric',
    grade: 'confirmed', severity: 'blocking',
    // 숫자로 확인되는 것이라 확정이다. 그래도 「위법」이라 쓰지 않는다
    params: { general: 7, negotiated: 40, urgent: 5, rebid: 5 },
    enabled: true,
  },
  {
    id: 'R04', title: '실적 요건 과다', method: 'numeric',
    grade: 'suspected', severity: 'competition',
    params: { maxSingleRecordRatio: 1.0, maxRecordCount: 3 },
    enabled: true,
  },
  {
    id: 'R05', title: '자본금과 매출 요건', method: 'numeric',
    grade: 'suspected', severity: 'competition',
    params: { maxCapitalRatio: 0.5, maxRevenueRatio: 2.0 },
    enabled: true,
  },
  {
    id: 'R06', title: '인력 요건 대비 예산', method: 'numeric',
    grade: 'confirmed', severity: 'margin',
    params: {
      // KOSA 공표 SW 기술자 평균임금. 관리자가 해마다 넣는다
      laborRateKrwPerMonth: { 특급: 9_500_000, 고급: 7_800_000, 중급: 6_200_000, 초급: 4_800_000 },
      maxLaborCostRatio: 1.1,
    },
    enabled: true,
  },
  {
    id: 'R07', title: '기간 대비 산출물', method: 'numeric',
    grade: 'suspected', severity: 'margin',
    // 축적 DB 가 없을 때 쓰는 고정 임계값
    params: { fallbackRequirementsPerMonth: 12, multiplier: 2 },
    enabled: true,
  },
  {
    id: 'R08', title: '지식재산권 귀속', method: 'regex',
    grade: 'suspected', severity: 'contract',
    params: {
      patterns: ['저작권.{0,10}전부.{0,10}(발주|기관).{0,6}귀속', '소스\\s?코드.{0,10}무상', '무상.{0,6}유지보수', '무제한.{0,6}수정'],
    },
    enabled: true,
  },
  {
    id: 'R09', title: '손해배상과 지체상금', method: 'regex_numeric',
    grade: 'suspected', severity: 'contract',
    params: { maxDelayRate: 0.0025, maxGuaranteeRate: 0.1, patterns: ['무한.{0,4}책임', '전액.{0,4}배상'] },
    enabled: true,
  },
  {
    id: 'R10', title: '상충 기재', method: 'numeric',
    grade: 'confirmed', severity: 'blocking',
    params: { amountTolerance: 0.01, dateToleranceDays: 1 },
    enabled: true,
  },
  {
    id: 'R11', title: '특정 인증 요구', method: 'dictionary',
    grade: 'suspected', severity: 'competition',
    params: {
      certifications: ['CSAP', 'GS인증 1등급', '파트너 등급', 'Gold Partner', 'Premier Partner', '총판'],
    },
    enabled: true,
  },
  {
    id: 'R12', title: '하도급과 공동수급 제한', method: 'regex',
    grade: 'suspected', severity: 'competition',
    params: {
      patterns: ['공동\\s?수급.{0,6}(불가|금지|제한)', '하도급.{0,6}(전면|일체).{0,4}금지', '지역.{0,6}업체.{0,10}(의무|이상)'],
    },
    enabled: true,
  },
]

export const RULE_IDS: readonly RuleId[] = DEFAULT_RULES.map((r) => r.id)

/** DB 행 → 규칙. 칸 이름이 바뀌면 여기 한 곳만 고친다 */
export function toRule(row: Record<string, unknown>): AnomalyRule {
  return {
    id: String(row.rule_id) as RuleId,
    title: String(row.title ?? ''),
    method: String(row.method ?? 'regex') as RuleMethod,
    grade: String(row.grade ?? 'suspected') as AnomalyGrade,
    severity: String(row.severity ?? 'competition') as AnomalySeverity,
    params: (row.params ?? {}) as Record<string, unknown>,
    enabled: row.enabled === undefined ? true : Boolean(row.enabled),
  }
}

/**
 * DB 규칙과 기본값을 합친다.
 *
 * DB 에 있는 규칙이 이긴다. 없는 규칙만 기본값으로 채운다 —
 * 관리자가 고친 값을 코드 배포가 덮으면 아무도 규칙을 안 고치게 된다.
 */
export function mergeRules(fromDb: readonly AnomalyRule[]): AnomalyRule[] {
  const byId = new Map(fromDb.map((r) => [r.id, r]))
  return DEFAULT_RULES.map((d) => byId.get(d.id) ?? d)
}
