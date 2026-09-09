/**
 * 제안서 목차 (설계서 F9)
 *
 * ## 목차를 평가 기준에서 뽑는 이유
 *
 * 제안서는 **평가위원이 점수를 매기려고 읽는 문서**다. 배점표에 「기술의 우수성 30점」이
 * 있으면 목차에 그 장이 있어야 하고, 없으면 평가위원이 점수를 줄 자리를 못 찾는다.
 * 그래서 목차는 우리가 쓰고 싶은 순서가 아니라 **배점표 순서**를 따른다.
 *
 * ## 근거 없는 목차는 남의 목차다
 *
 * 항목마다 어느 요구사항·배점에서 나왔는지 단다. 안 달면 다음 사업에서
 * 이 목차를 그대로 복사하게 되고, 그 사업의 배점표와 어긋난 채 제출된다.
 */

import type { Requirement } from '../structure/requirements.ts'

export interface EvaluationCriterion {
  name: string
  points: number
  /** 원문 근거 */
  blockId: string | null
}

export interface OutlineItem {
  /** 「1.」 「1.1」 */
  number: string
  title: string
  /** 배점표의 어느 항목에서 나왔나 */
  criterion: string | null
  points: number | null
  /** 어느 요구사항을 다루나 */
  requirementCodes: string[]
  /** 몇 쪽쯤 쓸까 — 배점 비율로 나눈다 */
  suggestedPages: number | null
  level: number
}

export interface BuildOutlineInput {
  criteria: readonly EvaluationCriterion[]
  requirements: readonly Requirement[]
  /** 제안서 분량 상한. 없으면 쪽 배분을 안 한다 */
  maxPages?: number | null
}

/** 배점표가 없을 때 쓰는 기본 목차 — 공공 제안서의 관행 순서 */
export const FALLBACK_SECTIONS: readonly { title: string; kinds: string[] }[] = [
  { title: '사업 이해', kinds: [] },
  { title: '추진 전략', kinds: [] },
  { title: '기능 요구사항 대응', kinds: ['functional'] },
  { title: '성능과 품질', kinds: ['performance', 'quality'] },
  { title: '보안', kinds: ['security'] },
  { title: '데이터와 인터페이스', kinds: ['data', 'interface'] },
  { title: '수행 조직과 일정', kinds: ['management', 'support'] },
  { title: '지원과 교육', kinds: ['support'] },
]

/**
 * 목차를 만든다.
 *
 * 배점표가 있으면 그 순서를 따르고, 없으면 관행 목차에 요구사항을 나눠 붙인다.
 */
export function buildOutline(input: BuildOutlineInput): OutlineItem[] {
  const byKind = groupByKind(input.requirements)

  if (input.criteria.length > 0) {
    const total = input.criteria.reduce((n, c) => n + Math.max(0, c.points), 0)
    return input.criteria
      // 배점 큰 항목을 앞에 — 평가위원이 먼저 보는 자리다
      .slice()
      .sort((a, b) => b.points - a.points)
      .map((c, i) => ({
        number: String(i + 1),
        title: c.name,
        criterion: c.name,
        points: c.points,
        requirementCodes: matchRequirements(c.name, input.requirements).map((r) => r.code),
        suggestedPages: pagesFor(c.points, total, input.maxPages ?? null),
        level: 1,
      }))
  }

  return FALLBACK_SECTIONS.map((s, i) => ({
    number: String(i + 1),
    title: s.title,
    criterion: null,
    points: null,
    requirementCodes: s.kinds.flatMap((k) => (byKind.get(k) ?? []).map((r) => r.code)),
    suggestedPages: null,
    level: 1,
  }))
}

function groupByKind(reqs: readonly Requirement[]): Map<string, Requirement[]> {
  const m = new Map<string, Requirement[]>()
  for (const r of reqs) {
    const list = m.get(r.kind)
    if (list) list.push(r)
    else m.set(r.kind, [r])
  }
  return m
}

/** 배점 항목 이름과 요구사항을 말로 맞춘다 */
export function matchRequirements(criterionName: string, reqs: readonly Requirement[]): Requirement[] {
  const n = criterionName.replace(/\s/g, '')
  const kindHint = KIND_HINTS.find((h) => h.words.some((w) => n.includes(w)))
  if (!kindHint) return []
  return reqs.filter((r) => r.kind === kindHint.kind)
}

const KIND_HINTS: readonly { kind: string; words: string[] }[] = [
  { kind: 'functional', words: ['기능', '업무'] },
  { kind: 'performance', words: ['성능', '용량', '응답'] },
  { kind: 'security', words: ['보안', '정보보호'] },
  { kind: 'data', words: ['데이터', '자료'] },
  { kind: 'interface', words: ['인터페이스', '연계'] },
  { kind: 'quality', words: ['품질', '시험', '테스트'] },
  { kind: 'management', words: ['관리', '조직', '일정', '수행'] },
  { kind: 'support', words: ['지원', '교육', '유지보수'] },
]

/** 배점 비율로 쪽을 나눈다 — 30점짜리에 두 쪽 쓰면 점수를 못 받는다 */
export function pagesFor(points: number, totalPoints: number, maxPages: number | null): number | null {
  if (!maxPages || totalPoints <= 0 || points <= 0) return null
  return Math.max(1, Math.round((points / totalPoints) * maxPages))
}

/** 다루지 않은 요구사항 — 제안서에 빠지면 감점이다 */
export function uncoveredRequirements(
  outline: readonly OutlineItem[], reqs: readonly Requirement[],
): Requirement[] {
  const covered = new Set(outline.flatMap((o) => o.requirementCodes))
  return reqs.filter((r) => !covered.has(r.code))
}
