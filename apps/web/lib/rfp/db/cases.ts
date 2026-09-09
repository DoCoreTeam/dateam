/**
 * 케이스 인입 검증 (설계서 3.2.1, 3.13.1)
 *
 * ## 등급에 기본값을 두지 않는 이유
 *
 * `doc_class` 에 기본값을 주면 **NDA 문서가 공개로 들어온다.** 한 번 공개로 들어오면
 * 그 뒤 모든 외부 호출이 «공개니까 보내도 된다»고 판단하고, 아무도 그 판단을 다시 보지 않는다.
 * 그래서 인입 시점에 사람이 반드시 고른다 — 고르지 않으면 케이스가 만들어지지 않는다.
 */

import { isDocClass, type DocClass } from '../domain/doc-class.ts'

export interface CaseInput {
  title: string
  docClass: DocClass
  sector?: string | null
  projectType?: string | null
  budgetAmount?: number | null
  durationMonths?: number | null
  proposalDeadline?: string | null
  sourceId?: string | null
}

export type CaseRejectReason =
  | 'missing_title'
  | 'missing_doc_class'
  | 'invalid_doc_class'
  | 'invalid_budget'
  | 'invalid_duration'
  | 'invalid_deadline'

export type CaseValidation =
  | { ok: true; value: CaseInput }
  | { ok: false; reason: CaseRejectReason; field: string }

export const MAX_TITLE_CHARS = 300

/**
 * 인입 요청을 검사한다.
 *
 * 경계에서 한 번만 검사하고, 통과한 값만 안쪽으로 보낸다 —
 * 안쪽에서 또 검사하기 시작하면 검사가 여러 벌이 되고 그중 하나가 느슨해진다.
 */
export function validateCaseInput(raw: unknown): CaseValidation {
  const body = (raw ?? {}) as Record<string, unknown>

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return { ok: false, reason: 'missing_title', field: 'title' }

  // 등급이 없으면 만들지 않는다. 기본값을 주면 NDA 가 공개로 들어온다
  if (body.docClass === undefined || body.docClass === null || body.docClass === '') {
    return { ok: false, reason: 'missing_doc_class', field: 'docClass' }
  }
  if (!isDocClass(body.docClass)) {
    return { ok: false, reason: 'invalid_doc_class', field: 'docClass' }
  }

  const budget = optionalNumber(body.budgetAmount)
  if (budget === 'invalid' || (typeof budget === 'number' && budget < 0)) {
    return { ok: false, reason: 'invalid_budget', field: 'budgetAmount' }
  }

  const months = optionalNumber(body.durationMonths)
  if (months === 'invalid' || (typeof months === 'number' && (months < 0 || !Number.isInteger(months)))) {
    return { ok: false, reason: 'invalid_duration', field: 'durationMonths' }
  }

  const deadline = optionalString(body.proposalDeadline)
  if (deadline && Number.isNaN(Date.parse(deadline))) {
    return { ok: false, reason: 'invalid_deadline', field: 'proposalDeadline' }
  }

  return {
    ok: true,
    value: {
      title: title.slice(0, MAX_TITLE_CHARS),
      docClass: body.docClass,
      sector: optionalString(body.sector),
      projectType: optionalString(body.projectType),
      budgetAmount: typeof budget === 'number' ? budget : null,
      durationMonths: typeof months === 'number' ? months : null,
      proposalDeadline: deadline,
      sourceId: optionalString(body.sourceId),
    },
  }
}

function optionalString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function optionalNumber(v: unknown): number | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 'invalid'
}

/** 목록 조회 파라미터 — 상한을 두지 않으면 케이스 만 건을 한 번에 긁는다 */
export const MAX_PAGE_SIZE = 100
export const DEFAULT_PAGE_SIZE = 20

export function readPageSize(raw: string | null): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_SIZE
  return Math.min(MAX_PAGE_SIZE, Math.floor(n))
}
