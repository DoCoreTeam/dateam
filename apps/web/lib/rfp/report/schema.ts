/**
 * 리포트 스키마 (설계서 3.6.1)
 *
 * ## 값 노드에 공통 속성 6개를 붙이는 이유
 *
 * 「사업금액 5억원」 이라는 값만 있으면 화면이 그것을 **사실처럼** 그린다.
 * 그런데 그 값은 ⓐ 어느 모델이 ⓑ 원문 어디를 보고 ⓒ 얼마나 확신하며 ⓓ 근거가 실제로
 * 대조됐는지에 따라 전혀 다른 무게를 갖는다. 여섯 속성이 그 무게다.
 *
 * ## 타입만으로는 못 지킨다
 *
 * 타입은 런타임에 사라진다. 「설계서와 1:1 인가」를 검사하려면 **이름이 값으로 남아야** 한다 —
 * 아래 배열들이 그 자리다.
 */

import type { DocClass } from '../domain/doc-class.ts'

/** 리포트 최상위 11종 (설계서 3.6.1) */
export const REPORT_TOP_KEYS = [
  'overview', 'scope', 'schedule', 'budget', 'constraints',
  'checklist', 'evaluation', 'anomalies', 'fit', 'comparisons', 'meta',
] as const
export type ReportTopKey = (typeof REPORT_TOP_KEYS)[number]

/** 값 노드 공통 속성 6종 */
export const VALUE_NODE_KEYS = [
  'value', 'evidence', 'confidence', 'grounding', 'vendor', 'verification',
] as const

/** 근거가 실제로 원문에 있는지 대조됐나 */
export type Grounding = 'confirmed' | 'unconfirmed'

/** 여러 벤더가 같은 값을 냈나 */
export type Verification = 'single' | 'agreed' | 'majority' | 'conflict' | 'user_fixed'

export interface Evidence {
  documentFileId: string
  blockId: string
  /** 보여 주기용. 정식 참조는 blockId 다 */
  pageNo: number | null
  /** 원문 그대로. 40자 이상이라야 대조가 의미 있다 */
  quote: string
}

/** 리포트의 모든 사실 값은 이 모양이다 */
export interface ValueNode<T> {
  value: T | null
  evidence: Evidence[]
  /** 0~1. null 이면 모델이 확신을 말하지 않았다 */
  confidence: number | null
  grounding: Grounding
  /** 어느 모델이 냈나 */
  vendor: string | null
  verification: Verification
}

/** 값이 없을 때의 기본 모양 — null 을 그냥 두면 화면이 «없음» 과 «못 찾음» 을 못 가른다 */
export function emptyValue<T>(): ValueNode<T> {
  return {
    value: null,
    evidence: [],
    confidence: null,
    // 근거를 안 댔으면 미확인이다. 기본을 확인으로 두면 전부 확인으로 보인다
    grounding: 'unconfirmed',
    vendor: null,
    verification: 'single',
  }
}

export function makeValue<T>(value: T, over: Partial<ValueNode<T>> = {}): ValueNode<T> {
  return { ...emptyValue<T>(), value, ...over }
}

/** 인용이 이보다 짧으면 대조가 의미 없다 (설계서 3.6.2) */
export const MIN_QUOTE_CHARS = 40

/**
 * 값 노드가 규격에 맞나.
 *
 * **근거 없이 grounding 이 confirmed 인 것을 막는다** — 그게 통과하면
 * 모델이 「확인했다」고 말하는 것만으로 화면에 확인 배지가 뜬다.
 */
export function validateValueNode(node: unknown): string[] {
  const problems: string[] = []
  if (!node || typeof node !== 'object') return ['값 노드가 객체가 아니다']
  const n = node as Record<string, unknown>

  for (const k of VALUE_NODE_KEYS) {
    if (!(k in n)) problems.push(`값 노드에 ${k} 가 없다`)
  }
  if (!Array.isArray(n.evidence)) problems.push('evidence 가 배열이 아니다')
  else {
    for (const e of n.evidence as Record<string, unknown>[]) {
      if (!e.blockId) problems.push('근거에 blockId 가 없다')
      if (typeof e.quote !== 'string' || e.quote.length < MIN_QUOTE_CHARS) {
        problems.push(`인용이 ${MIN_QUOTE_CHARS}자보다 짧다`)
      }
    }
  }
  if (n.grounding === 'confirmed' && Array.isArray(n.evidence) && n.evidence.length === 0) {
    problems.push('근거 없이 확인으로 표시했다')
  }
  if (n.confidence !== null && (typeof n.confidence !== 'number' || n.confidence < 0 || n.confidence > 1)) {
    problems.push('confidence 가 0~1 이 아니다')
  }
  return problems
}

// 최상위 모양

export interface ReportMeta {
  analysisMode: 'base' | 'cross' | 'compare'
  baseVendor: string | null
  crossVendors: string[]
  fallbackApplied: boolean
  costKrw: number
  durationMs: number
  parserQuality: number
  generatedAt: string
  /** AI 기본법 투명성 의무 — 리포트·내보내기 전부에 붙는다 */
  aiNotice: string
  docClass: DocClass
}

export interface Report {
  overview: Record<string, ValueNode<unknown>>
  scope: Record<string, ValueNode<unknown>>
  schedule: Record<string, ValueNode<unknown>>
  budget: Record<string, ValueNode<unknown>>
  constraints: Record<string, ValueNode<unknown>>
  checklist: Record<string, ValueNode<unknown>>
  evaluation: Record<string, ValueNode<unknown>>
  anomalies: unknown[]
  fit: Record<string, ValueNode<unknown>> | null
  comparisons: unknown[]
  meta: ReportMeta
}

/** 빈 리포트 — 최상위 칸을 undefined 로 두면 소비하는 쪽이 전부 옵셔널 체이닝을 단다 */
export function emptyReport(meta: ReportMeta): Report {
  return {
    overview: {}, scope: {}, schedule: {}, budget: {}, constraints: {},
    checklist: {}, evaluation: {}, anomalies: [], fit: null, comparisons: [], meta,
  }
}

/** 리포트가 규격의 11칸을 다 갖고 있나 */
export function validateReport(report: unknown): string[] {
  if (!report || typeof report !== 'object') return ['리포트가 객체가 아니다']
  const r = report as Record<string, unknown>
  const problems: string[] = []
  for (const k of REPORT_TOP_KEYS) {
    if (!(k in r)) problems.push(`리포트에 ${k} 가 없다`)
  }
  return problems
}

/** 모델에 강제할 JSON Schema — 벤더가 스키마 강제를 지원하면 그대로 넘긴다 */
export function valueNodeJsonSchema(valueSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    required: Array.from(VALUE_NODE_KEYS),
    additionalProperties: false,
    properties: {
      value: valueSchema,
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          required: ['documentFileId', 'blockId', 'quote'],
          properties: {
            documentFileId: { type: 'string' },
            blockId: { type: 'string' },
            pageNo: { type: ['integer', 'null'] },
            quote: { type: 'string', minLength: MIN_QUOTE_CHARS },
          },
        },
      },
      confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
      grounding: { enum: ['confirmed', 'unconfirmed'] },
      vendor: { type: ['string', 'null'] },
      verification: { enum: ['single', 'agreed', 'majority', 'conflict', 'user_fixed'] },
    },
  }
}
