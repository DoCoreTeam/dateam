/**
 * 리포트 칸의 한글 이름 (사용자 개입)
 *
 * ## 왜 필요한가
 *
 * 리포트 화면이 **필드 키를 그대로 찍고 있었다** — `currency`·`totalAmount`·`vatIncluded`.
 * 사용자가 「디자인이 하나도 안 먹었다」고 한 것의 절반이 이것이다.
 * 값은 맞게 뽑았는데 이름이 영어라 무슨 값인지 읽을 수가 없었다.
 *
 * ## 왜 가드에 안 걸렸나
 *
 * 「화면에 한글을 직접 적지 마라」는 가드는 **한글**을 찾는다.
 * 영문 키를 그대로 쓰면 한글이 아니니 통과한다 — 규칙이 막으려던 것(말이 흩어지는 것)은
 * 똑같이 일어났는데 검사만 비껴갔다. 그래서 이름표를 여기 한곳에 모은다.
 *
 * ## 모르는 칸은 버리지 않는다
 *
 * 모델이 새 칸을 내면 이름표가 없다. 그때 화면에서 감추면 값이 조용히 사라진다 —
 * 키를 그대로 보여 주되 「이름 없는 칸」으로 표시해서 여기에 더할 거리를 남긴다.
 */

/** 태스크가 채우는 최상위 절 */
export const SECTION_LABEL: Record<string, string> = {
  overview: '개요',
  scope: '범위와 산출물',
  schedule: '일정',
  budget: '예산',
  constraints: '제약과 자격',
  checklist: '제출 서류',
  evaluation: '평가 기준',
  anomalies: '이상 조항',
  fit: '적합도',
}

/** 화면에 보이는 순서 — 사업을 판단하는 순서다 */
export const SECTION_ORDER: readonly string[] = [
  'overview', 'budget', 'schedule', 'scope', 'evaluation', 'constraints', 'checklist',
]

/**
 * 칸 이름표.
 *
 * 같은 이름이 여러 절에 나오지 않게 **절과 무관하게 유일**하게 지었다
 * (`title` 은 개요에만, `method` 는 평가에만 있다).
 */
export const FIELD_LABEL: Record<string, string> = {
  // 개요
  title: '사업명',
  agency: '발주 기관',
  demandAgency: '수요 기관',
  purpose: '사업 목적',
  background: '추진 배경',
  summary: '한 줄 요약',
  projectType: '사업 유형',
  classificationCodes: '분류 번호',

  // 범위와 산출물
  deliverables: '산출물',
  workItems: '과업 항목',
  outOfScope: '과업에서 빠진 것',
  requirements: '요구사항',

  // 일정
  start: '시작일',
  end: '종료일',
  durationMonths: '사업 기간',
  milestones: '주요 시점',
  proposalDeadline: '제안서 마감',
  bidOpenDate: '개찰일',
  qnaDeadline: '질의 마감',
  briefingDate: '설명회',

  // 예산
  totalAmount: '사업 예산',
  currency: '통화',
  vatIncluded: '부가세 포함',
  budgetBasis: '예산 근거',
  paymentTerms: '대가 지급',
  priceScoreMethod: '가격 평가 방식',
  mentions: '눈여겨볼 조항',

  // 제약과 자격
  technical: '기술 요건',
  personnel: '참여 인력 요건',
  eligibility: '참가 자격',
  legal: '법적 요건',
  security: '보안 요건',
  location: '수행 장소',
  subcontracting: '하도급',

  // 제출 서류
  documents: '제출 서류',
  eligibilityChecks: '자격 확인 항목',
  preparation: '준비할 것',

  // 평가 기준
  method: '평가 방법',
  technicalWeight: '기술 배점',
  priceWeight: '가격 배점',
  criteria: '평가 항목',
  presentationRequired: '발표 여부',

  // 이상 조항
  candidates: '의심 조항',
}

/** 이름표가 없는 칸임을 화면이 말할 수 있게 */
export const UNLABELED_SUFFIX = '(이름 없는 칸)'

/** 칸 이름 — 모르면 키를 보여 주되 모른다고 밝힌다 */
export function fieldLabel(key: string): string {
  return FIELD_LABEL[key] ?? `${key} ${UNLABELED_SUFFIX}`
}

/** 절 이름 — 모르면 키 그대로 */
export function sectionLabel(key: string): string {
  return SECTION_LABEL[key] ?? key
}

/** 이 절의 칸을 화면 순서대로 — 이름표가 있는 것이 먼저다 */
export function orderFields(keys: readonly string[]): string[] {
  const known = Object.keys(FIELD_LABEL)
  return Array.from(keys).sort((a, b) => {
    const ia = known.indexOf(a)
    const ib = known.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

/** 절을 화면 순서대로 — 순서표에 없는 절은 뒤로 */
export function orderSections(keys: readonly string[]): string[] {
  return Array.from(keys).sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a)
    const ib = SECTION_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

/**
 * 숫자 뒤에 붙는 단위.
 *
 * 단위 없는 숫자는 화면에서 「1.5」로만 남아 무슨 뜻인지 모른다
 * (실측 2026-09-09: 사업 기간이 그냥 1.5 로 보였다).
 * 값 안에 단위가 들어 있는 경우는 여기 두지 않는다 — 두 번 붙는다.
 */
export const FIELD_UNIT: Record<string, string> = {
  durationMonths: '개월',
  technicalWeight: '점',
  priceWeight: '점',
}

export function fieldUnit(key: string): string {
  return FIELD_UNIT[key] ?? ''
}
