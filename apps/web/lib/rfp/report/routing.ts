/**
 * 섹션 라우팅 (설계서 3.6.2)
 *
 * ## 왜 문서 전체를 안 넣나
 *
 * 200쪽짜리를 통째로 넣으면 ⓐ 비용이 쪽 수에 비례하고 ⓑ 모델이 **가운데를 흘린다.**
 * 예산 태스크에 평가 기준 장을 넣을 이유가 없다.
 *
 * ## 60% 를 넘으면 나눈다
 *
 * 컨텍스트를 꽉 채우면 모델이 출력할 자리가 없다. 그리고 한계 근처에서는
 * **긴 문서의 중간을 건너뛰는** 현상이 눈에 띄게 늘어난다.
 * 그래서 관련 섹션 합계가 60% 를 넘으면 청크로 나눠 여러 번 묻고 합친다.
 *
 * ## 못 찾은 필드는 전체 문맥으로 한 번 더
 *
 * 라우팅이 틀릴 수 있다 — 「사업기간」이 일정 장이 아니라 개요에 한 줄로 있는 공고가 있다.
 * 한 번은 더 물어야 한다. 다만 **한 번만** — 안 그러면 못 찾는 필드마다 전체 문서를 태운다.
 */

import type { IrDocument, IrSection, SectionCategory } from '../ir/types.ts'
import type { ExtractTask } from './tasks.ts'

/** 컨텍스트의 이 비율을 넘으면 나눈다 */
export const CONTEXT_BUDGET_RATIO = 0.6

/** 글자 수를 토큰 수로 어림잡는다. 한글은 글자당 대략 1토큰에 가깝다 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length * 0.9)
}

export interface RoutedSection {
  section: IrSection
  text: string
  tokens: number
  /** 태스크의 관련 분류 목록에서 몇 번째인가. 작을수록 관련이 크다 */
  rank: number
}

export interface RoutingPlan {
  /** 한 번에 넣을 묶음들. 하나면 분할이 없었다는 뜻 */
  batches: RoutedSection[][]
  /** 분할이 일어났나 */
  split: boolean
  totalTokens: number
  budgetTokens: number
  /** 관련 섹션이 하나도 없었나 — 그러면 전체 문맥으로 가야 한다 */
  empty: boolean
}

/**
 * 태스크에 넣을 섹션을 고르고 필요하면 나눈다.
 *
 * 관련이 큰 분류부터 담는다 — 나눠야 할 때 **뒤쪽(관련이 적은 것)이 뒤 묶음으로 밀린다.**
 */
export function routeSections(
  doc: IrDocument,
  task: ExtractTask,
  contextTokens: number,
): RoutingPlan {
  const budget = Math.floor(contextTokens * CONTEXT_BUDGET_RATIO)
  const textOf = sectionTextIndex(doc)

  const picked: RoutedSection[] = []
  task.categories.forEach((cat, rank) => {
    for (const s of doc.sections) {
      if (s.category !== cat) continue
      const text = textOf.get(s.sectionId) ?? ''
      if (!text.trim()) continue
      picked.push({ section: s, text, tokens: estimateTokens(text), rank })
    }
  })

  // 같은 분류 안에서는 원문 순서를 지킨다 — 뒤섞으면 인용의 앞뒤 문맥이 깨진다
  picked.sort((a, b) => a.rank - b.rank || a.section.orderNo - b.section.orderNo)

  const totalTokens = picked.reduce((n, p) => n + p.tokens, 0)
  if (picked.length === 0) {
    return { batches: [], split: false, totalTokens: 0, budgetTokens: budget, empty: true }
  }
  if (totalTokens <= budget) {
    return { batches: [picked], split: false, totalTokens, budgetTokens: budget, empty: false }
  }

  // 넘치면 나눈다. 한 섹션이 예산보다 커도 혼자 한 묶음이 된다(더 잘게는 여기서 안 자른다)
  const batches: RoutedSection[][] = []
  let current: RoutedSection[] = []
  let used = 0
  for (const p of picked) {
    if (current.length > 0 && used + p.tokens > budget) {
      batches.push(current)
      current = []
      used = 0
    }
    current.push(p)
    used += p.tokens
  }
  if (current.length > 0) batches.push(current)

  return { batches, split: true, totalTokens, budgetTokens: budget, empty: false }
}

/** 섹션마다 본문을 모아 둔다 */
function sectionTextIndex(doc: IrDocument): Map<string, string> {
  const byBlock = new Map(doc.blocks.map((b) => [b.blockId, b]))
  const out = new Map<string, string>()
  for (const s of doc.sections) {
    const parts: string[] = []
    if (s.number || s.title) parts.push([s.number, s.title].filter(Boolean).join(' '))
    for (const id of s.blockIds) {
      const b = byBlock.get(id)
      if (b?.text) parts.push(b.text)
    }
    out.set(s.sectionId, parts.join('\n'))
  }
  return out
}

/**
 * 라우팅으로 못 찾은 필드에만 전체 문맥으로 한 번 더 묻는다.
 *
 * **한 번만** 이다 — 못 찾는 필드마다 전체 문서를 태우면 한 케이스에 수십만 원이 든다.
 */
export interface FallbackPass {
  needed: boolean
  fields: string[]
  /** 이미 한 번 돌았으면 다시 안 돈다 */
  alreadyRan: boolean
}

export function planFallback(
  task: ExtractTask,
  filled: ReadonlySet<string>,
  alreadyRan: boolean,
): FallbackPass {
  const missing = task.fields.filter((f) => !filled.has(f))
  return {
    needed: missing.length > 0 && !alreadyRan,
    fields: missing,
    alreadyRan,
  }
}

/** 묶음을 실제 프롬프트 본문으로 만든다 */
export function renderBatch(batch: readonly RoutedSection[]): string {
  return batch
    .map((r) => {
      const head = [r.section.number, r.section.title].filter(Boolean).join(' ')
      // 섹션 ID 를 함께 적어 둔다. 모델이 근거를 댈 때 이 값을 되돌려준다
      return `[섹션 ${r.section.sectionId}${head ? ` ${head}` : ''}]\n${r.text}`
    })
    .join('\n\n')
}

/** 어느 분류가 어느 태스크에 쓰이나 — 화면이 「이 장은 어디에 쓰였나」를 보여 줄 때 */
export function tasksForCategory(
  tasks: readonly ExtractTask[], category: SectionCategory,
): string[] {
  return tasks.filter((t) => t.categories.includes(category)).map((t) => t.id)
}
