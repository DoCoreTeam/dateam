/**
 * 정형 비교표 (설계서 3.12)
 *
 * ## 「비슷하다」로는 아무것도 못 한다
 *
 * 유사 사업 다섯 건을 찾아 놓고 「비슷합니다」라고만 하면 사용자가 할 일이 없다.
 * **무엇이 어떻게 다른지** 를 같은 자로 재서 나란히 놔야 한다 —
 * 예산·기간·자격·산출물 수.
 *
 * ## 양쪽 근거를 함께 싣는다
 *
 * 「이 사업은 자격이 더 빡빡하다」는 문장만 있으면 사용자가 확인할 방법이 없다.
 * 양쪽 원문을 함께 보여 줘야 그 문장을 믿거나 반박할 수 있다.
 */

import { withJosa, iGa } from '../../ui/josa.ts'
import type { Evidence, Report, ValueNode } from '../report/schema.ts'

/** 비교하는 축 — 같은 자로 재는 것만 넣는다 */
export type CompareAxis = 'budget' | 'duration' | 'eligibility' | 'deliverables' | 'evaluation'

export const COMPARE_AXES: readonly CompareAxis[] = [
  'budget', 'duration', 'eligibility', 'deliverables', 'evaluation',
]

export const AXIS_FIELD: Record<CompareAxis, string> = {
  budget: 'budget.totalAmount',
  duration: 'schedule.durationMonths',
  eligibility: 'constraints.eligibility',
  deliverables: 'scope.deliverables',
  evaluation: 'evaluation.technicalWeight',
}

export interface AxisCell {
  value: unknown
  /** 양쪽 원문을 함께 보여 줘야 문장을 믿거나 반박할 수 있다 */
  evidence: Evidence[]
  confidence: number | null
}

export interface AxisRow {
  axis: CompareAxis
  mine: AxisCell
  theirs: AxisCell
  /** 숫자 축만 채운다. 몇 배 차이인가 */
  ratio: number | null
  /** 목록 축만 채운다. 상대에만 있는 항목 */
  onlyTheirs: string[]
  onlyMine: string[]
}

export interface ComparisonRow {
  caseId: string
  title: string
  similarity: number
  axes: AxisRow[]
  /** 사람이 읽을 한 줄 — 「무엇이 다른가」 */
  summary: string
}

function pick(report: Report, path: string): ValueNode<unknown> | null {
  const [bucket, key] = path.split('.')
  const b = (report as unknown as Record<string, Record<string, ValueNode<unknown>>>)[bucket]
  return b?.[key] ?? null
}

function cellOf(report: Report, path: string): AxisCell {
  const node = pick(report, path)
  return {
    value: node?.value ?? null,
    evidence: node?.evidence ?? [],
    confidence: node?.confidence ?? null,
  }
}

/** 목록 축은 항목 이름으로 비교한다 */
function toNames(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string' ? x : (x as { name?: unknown })?.name))
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim())
}

/**
 * 두 리포트를 다섯 축으로 나란히 놓는다.
 *
 * 한쪽에만 값이 있어도 행을 만든다 — 「저쪽에는 있는데 우리 쪽엔 없다」가
 * 사용자가 가장 알고 싶은 것이다.
 */
export function compareReports(
  mine: Report,
  theirs: Report,
  meta: { caseId: string; title: string; similarity: number },
): ComparisonRow {
  const axes: AxisRow[] = COMPARE_AXES.map((axis) => {
    const path = AXIS_FIELD[axis]
    const a = cellOf(mine, path)
    const b = cellOf(theirs, path)

    const na = typeof a.value === 'number' ? a.value : null
    const nb = typeof b.value === 'number' ? b.value : null
    const ratio = na !== null && nb !== null && Math.min(na, nb) > 0
      ? Math.max(na, nb) / Math.min(na, nb)
      : null

    const listA = toNames(a.value)
    const listB = toNames(b.value)

    return {
      axis,
      mine: a,
      theirs: b,
      ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
      onlyTheirs: listB.filter((x) => !listA.includes(x)),
      onlyMine: listA.filter((x) => !listB.includes(x)),
    }
  })

  return { ...meta, axes, summary: summarize(axes) }
}

/** 「무엇이 다른가」 한 줄. 다른 것이 없으면 그렇게 말한다 */
function summarize(axes: readonly AxisRow[]): string {
  const parts: string[] = []
  for (const a of axes) {
    if (a.ratio !== null && a.ratio >= 1.2) {
      const bigger = (a.theirs.value as number) > (a.mine.value as number) ? '더 크다' : '더 작다'
      // 조사를 손으로 적으면 「사업 금액가」가 나온다(용어집 §0-2)
      parts.push(`${withJosa(AXIS_LABEL[a.axis], iGa)} ${a.ratio}배 ${bigger}`)
      continue
    }
    if (a.onlyTheirs.length > 0) {
      parts.push(`${AXIS_LABEL[a.axis]}에 ${a.onlyTheirs.length}건이 더 있다`)
    }
  }
  return parts.length > 0 ? parts.join(', ') : '다섯 축에서 뚜렷한 차이가 없다'
}

/** 축 이름 — 화면에 그대로 나간다 */
export const AXIS_LABEL: Record<CompareAxis, string> = {
  budget: '사업 금액',
  duration: '사업 기간',
  eligibility: '참가 자격',
  deliverables: '산출물',
  evaluation: '기술 배점',
}

/** 근거가 한 쪽이라도 비면 비교를 믿기 어렵다 — 화면이 경고를 띄운다 */
export function hasBothEvidence(row: AxisRow): boolean {
  return row.mine.evidence.length > 0 && row.theirs.evidence.length > 0
}

export function evidenceCoverage(rows: readonly AxisRow[]): number {
  const filled = rows.filter((r) => r.mine.value !== null || r.theirs.value !== null)
  if (filled.length === 0) return 0
  return filled.filter(hasBothEvidence).length / filled.length
}
