/**
 * 리포트 필드 단위 diff (설계서 F11)
 *
 * ## 값만 보여 주면 못 믿는다
 *
 * 「사업 금액 5억 → 6억」만 보여 주면 사용자는 **어느 쪽이 맞는지** 모른다.
 * 우리가 잘못 읽었을 수도 있고 정말 바뀌었을 수도 있다.
 * 그래서 양쪽 근거를 함께 낸다 — 원문을 보면 1초에 판단된다.
 *
 * ## 사라진 값도 변화다
 *
 * 앞 차수에 있던 값이 새 차수에 없으면 그것도 알려야 한다.
 * 「없어졌다」와 「우리가 못 찾았다」는 다르지만, 둘 다 사람이 봐야 할 일이다.
 */

import type { Evidence, Report, ValueNode } from '../report/schema.ts'

export type ChangeKind = 'added' | 'removed' | 'changed' | 'unchanged'

export interface FieldDiff {
  fieldPath: string
  kind: ChangeKind
  before: unknown
  after: unknown
  /** 양쪽 근거 — 원문을 보면 1초에 판단된다 */
  beforeEvidence: Evidence[]
  afterEvidence: Evidence[]
}

/** 값을 견줄 때 쓰는 칸들 — 배열과 객체는 값이 같아도 참조가 달라 늘 「바뀜」이 된다 */
const DIFF_BUCKETS = ['overview', 'schedule', 'budget', 'evaluation', 'constraints', 'checklist', 'scope'] as const

export interface DiffResult {
  diffs: FieldDiff[]
  changed: number
  added: number
  removed: number
}

/**
 * 두 리포트를 필드 단위로 견준다.
 *
 * 안 바뀐 것도 목록에 남긴다 — 화면이 「바뀐 것만 보기」를 켜고 끌 수 있게.
 */
export function diffReports(before: Report, after: Report): DiffResult {
  const diffs: FieldDiff[] = []

  for (const bucket of DIFF_BUCKETS) {
    const a = (before[bucket] ?? {}) as Record<string, ValueNode<unknown>>
    const b = (after[bucket] ?? {}) as Record<string, ValueNode<unknown>>
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])

    for (const key of Array.from(keys).sort()) {
      const na = a[key]
      const nb = b[key]
      const va = na?.value ?? null
      const vb = nb?.value ?? null

      const kind: ChangeKind =
        va === null && vb !== null ? 'added'
        : va !== null && vb === null ? 'removed'
        : sameValue(va, vb) ? 'unchanged'
        : 'changed'

      diffs.push({
        fieldPath: `${bucket}.${key}`,
        kind,
        before: va,
        after: vb,
        beforeEvidence: na?.evidence ?? [],
        afterEvidence: nb?.evidence ?? [],
      })
    }
  }

  return {
    diffs,
    changed: diffs.filter((d) => d.kind === 'changed').length,
    added: diffs.filter((d) => d.kind === 'added').length,
    removed: diffs.filter((d) => d.kind === 'removed').length,
  }
}

/** 값이 같은가 — 배열과 객체는 내용으로 견준다 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') return JSON.stringify(canon(a)) === JSON.stringify(canon(b))
  return false
}

/** 배열 순서가 달라도 같은 값으로 본다 — 모델이 순서를 흔든다 */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon).map((x) => JSON.stringify(x)).sort()
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canon((v as Record<string, unknown>)[k])
    }
    return out
  }
  return v
}

/** 바뀐 것만 — 화면 기본 보기 */
export function onlyChanges(result: DiffResult): FieldDiff[] {
  return result.diffs.filter((d) => d.kind !== 'unchanged')
}

/** 사람이 읽을 한 줄 요약 */
export function summarize(result: DiffResult): string {
  const parts: string[] = []
  if (result.changed > 0) parts.push(`${result.changed}건 변경`)
  if (result.added > 0) parts.push(`${result.added}건 추가`)
  if (result.removed > 0) parts.push(`${result.removed}건 삭제`)
  return parts.length > 0 ? parts.join(', ') : '바뀐 값이 없다'
}

/** 무거운 변화인가 — 이 필드가 바뀌면 제안 전략이 흔들린다 */
export const CRITICAL_FIELDS: readonly string[] = [
  'budget.totalAmount',
  'budget.vatIncluded',
  'schedule.proposalDeadline',
  'schedule.durationMonths',
  'constraints.eligibility',
  'evaluation.technicalWeight',
]

export function criticalChanges(result: DiffResult): FieldDiff[] {
  return onlyChanges(result).filter((d) => CRITICAL_FIELDS.includes(d.fieldPath))
}
