/**
 * 어시스턴트 컨텍스트 모으기 (설계서 3.9.2, 3.13.1)
 *
 * ## 등급이 섞이면 답을 못 만든다
 *
 * 「우리가 참여한 사업 중 보안 요건이 빡빡했던 것」을 물으면 컨텍스트에
 * **공개 공고문과 NDA 제안요청서가 함께** 담긴다. 그 묶음을 공개 모델에 보내면
 * NDA 문서가 그 길로 나간다.
 *
 * 그래서 컨텍스트가 만들어진 뒤 **가장 높은 등급**을 보고 둘 중 하나를 한다.
 *   ① 그 등급을 감당하는 벤더로 바꾼다 (사내 모델이 있으면 대개 여기서 끝난다)
 *   ② 감당할 벤더가 없으면 상위 등급 청크를 **뺀다**
 *
 * 뺐다는 사실은 답에 적는다 — 조용히 빼면 사용자는 그 문서가 없는 줄 안다.
 */

import { maxDocClass, decideTransfer, type DocClass } from '../domain/doc-class.ts'
import type { AiModel } from '../ai/models.ts'

export interface ContextChunk {
  chunkKey: string
  caseId: string
  text: string
  docClass: DocClass
  /** 화면이 근거로 되돌아갈 자리 */
  blockIds: string[]
  score: number
}

export type ContextDecision =
  | { action: 'send'; model: AiModel; chunks: ContextChunk[]; droppedForClass: ContextChunk[] }
  | { action: 'blocked'; reason: string; docClass: DocClass }

export interface BuildContextInput {
  chunks: readonly ContextChunk[]
  /** 앞이 1순위 */
  models: readonly AiModel[]
  adminApproved?: boolean
  maxChunks?: number
}

export const DEFAULT_MAX_CHUNKS = 12

/**
 * 컨텍스트를 만들고 보낼 모델을 고른다.
 *
 * 등급을 감당하는 모델을 먼저 찾고, 없으면 상위 등급을 빼고 다시 찾는다.
 * **순서가 반대면 안 된다** — 뺄 수 있다고 먼저 빼면 사내 모델이 있는데도
 * 문서를 잘라 답이 얕아진다.
 */
export function buildContext(input: BuildContextInput): ContextDecision {
  const max = input.maxChunks ?? DEFAULT_MAX_CHUNKS
  const picked = Array.from(input.chunks).sort((a, b) => b.score - a.score).slice(0, max)
  if (picked.length === 0) {
    return { action: 'blocked', reason: 'no_context', docClass: 'public' }
  }

  const highest = maxDocClass(picked.map((c) => c.docClass))

  // ① 그 등급을 감당하는 벤더를 먼저 찾는다
  const capable = input.models.find((m) => allows(m, highest, input.adminApproved))
  if (capable) {
    return { action: 'send', model: capable, chunks: picked, droppedForClass: [] }
  }

  // ② 없으면 상위 등급 청크를 뺀다
  for (const level of ['restricted', 'public'] as DocClass[]) {
    const kept = picked.filter((c) => rank(c.docClass) <= rank(level))
    if (kept.length === 0) continue
    const model = input.models.find((m) => allows(m, maxDocClass(kept.map((c) => c.docClass)), input.adminApproved))
    if (!model) continue
    return {
      action: 'send',
      model,
      chunks: kept,
      // 뺐다는 사실을 답에 적는다 — 조용히 빼면 그 문서가 없는 줄 안다
      droppedForClass: picked.filter((c) => !kept.includes(c)),
    }
  }

  return { action: 'blocked', reason: 'no_model_for_doc_class', docClass: highest }
}

function rank(c: DocClass): number {
  return c === 'public' ? 0 : c === 'restricted' ? 1 : 2
}

function allows(model: AiModel, docClass: DocClass, adminApproved?: boolean): boolean {
  if (!model.enabled) return false
  return decideTransfer({
    docClass,
    allowedDocClasses: model.allowedDocClasses,
    retention: model.retention,
    adminApproved,
    internal: model.internal,
  }).allowed
}

/** 컨텍스트를 프롬프트 본문으로 — 청크 키를 함께 적어 모델이 인용할 수 있게 한다 */
export function renderContext(chunks: readonly ContextChunk[]): string {
  return chunks
    .map((c, i) => `[${i + 1}|${c.chunkKey}]\n${c.text}`)
    .join('\n\n')
}
