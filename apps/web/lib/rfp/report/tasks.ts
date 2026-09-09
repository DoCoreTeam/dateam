/**
 * 추출 태스크 9종 (설계서 3.6.2)
 *
 * ## 왜 아홉으로 나누나
 *
 * 리포트 전체를 한 번에 물으면 모델이 **긴 문서의 가운데를 흘린다.** 그리고 어느 값이
 * 어느 근거에서 나왔는지 섞인다. 태스크로 나누면 각 태스크가 자기 섹션만 보고,
 * 한 태스크가 실패해도 나머지는 남는다.
 *
 * ## 공통 프롬프트 규칙을 여기 두는 이유
 *
 * 「원문에 없는 말을 만들지 마라」를 태스크마다 각자 적으면 그중 하나가 빠진다.
 * 빠진 태스크만 조용히 지어내고, 그 값이 다른 값들과 같은 모양으로 화면에 뜬다.
 */

import type { SectionCategory } from '../ir/types.ts'
import type { ReportTopKey } from './schema.ts'

export type TaskId =
  | 'overview' | 'scope' | 'schedule' | 'budget' | 'constraints'
  | 'checklist' | 'evaluation' | 'anomalies' | 'requirements'

export interface ExtractTask {
  id: TaskId
  title: string
  /** 이 태스크가 채우는 리포트 칸 */
  target: ReportTopKey | 'scope'
  /**
   * 먼저 넣을 섹션 분류. 앞이 더 관련 있다.
   * 설계서 예: 예산 태스크는 예산과 대가 지급, 입찰 안내, 사업 개요
   */
  categories: readonly SectionCategory[]
  /** 이 태스크가 뽑아야 할 말단 필드 */
  fields: readonly string[]
}

export const EXTRACT_TASKS: readonly ExtractTask[] = [
  {
    id: 'overview', title: '개요', target: 'overview',
    categories: ['overview', 'background', 'scope'],
    fields: ['title', 'agency', 'demandAgency', 'purpose', 'background', 'summary', 'projectType', 'classificationCodes'],
  },
  {
    id: 'scope', title: '범위와 산출물', target: 'scope',
    categories: ['scope', 'functional', 'requirement_summary', 'constraints'],
    fields: ['deliverables', 'workItems', 'outOfScope'],
  },
  {
    id: 'schedule', title: '일정', target: 'schedule',
    categories: ['schedule', 'bid_guide', 'overview'],
    fields: ['start', 'end', 'durationMonths', 'milestones', 'proposalDeadline', 'bidOpenDate', 'qnaDeadline', 'briefingDate'],
  },
  {
    id: 'budget', title: '예산', target: 'budget',
    categories: ['budget', 'bid_guide', 'overview'],
    fields: ['totalAmount', 'currency', 'vatIncluded', 'budgetBasis', 'paymentTerms', 'priceScoreMethod', 'mentions'],
  },
  {
    id: 'constraints', title: '제약과 자격', target: 'constraints',
    categories: ['constraints', 'eligibility', 'security', 'contract_terms', 'performance'],
    fields: ['technical', 'personnel', 'eligibility', 'legal', 'security', 'location', 'subcontracting'],
  },
  {
    id: 'checklist', title: '제출 서류', target: 'checklist',
    categories: ['bid_guide', 'forms', 'eligibility'],
    fields: ['documents', 'eligibilityChecks', 'preparation'],
  },
  {
    id: 'evaluation', title: '평가 기준', target: 'evaluation',
    categories: ['evaluation', 'bid_guide'],
    fields: ['method', 'technicalWeight', 'priceWeight', 'criteria', 'presentationRequired'],
  },
  {
    id: 'anomalies', title: '이상 조항 후보', target: 'anomalies',
    // 이상 조항은 어디에나 숨는다. 그래서 넓게 본다
    categories: ['eligibility', 'evaluation', 'contract_terms', 'constraints', 'performance', 'budget'],
    fields: ['candidates'],
  },
  {
    id: 'requirements', title: '요구사항 정규화', target: 'scope',
    categories: ['requirement_summary', 'functional', 'performance', 'security', 'constraints'],
    fields: ['requirements'],
  },
]

export const TASK_IDS: readonly TaskId[] = EXTRACT_TASKS.map((t) => t.id)

export function taskById(id: TaskId): ExtractTask {
  const t = EXTRACT_TASKS.find((x) => x.id === id)
  if (!t) throw new Error(`모르는 태스크다: ${id}`)
  return t
}

/**
 * 모든 태스크가 지키는 규칙.
 *
 * 태스크마다 각자 적으면 그중 하나가 빠지고, 빠진 태스크만 조용히 지어낸다.
 */
export const COMMON_RULES: readonly string[] = [
  '원문에 없는 내용을 만들지 않는다',
  `값마다 원문 그대로의 인용을 40자 이상 붙이고 블록 ID 를 함께 적는다`,
  '확신이 없으면 값을 null 로 두고 사유를 적는다',
  '금액은 숫자와 단위를 나눠 적는다',
  '날짜는 ISO 8601 로 적는다',
  '특정 업체에 유리하다고 단정하지 않는다. 「경쟁 제한 의심」으로만 적는다',
]

/** 태스크 프롬프트 앞머리 — 공통 규칙 + 이 태스크가 할 일 */
export function buildInstruction(task: ExtractTask): string {
  const rules = COMMON_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')
  return [
    `[${task.title}] 아래 원문에서 다음 값을 뽑는다.`,
    `뽑을 값: ${task.fields.join(', ')}`,
    '',
    '지켜야 할 규칙',
    rules,
  ].join('\n')
}
