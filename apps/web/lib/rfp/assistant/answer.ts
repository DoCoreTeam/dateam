/**
 * 어시스턴트 답변 다듬기 (설계서 3.9.3)
 *
 * ## 인용 태그를 검사하는 이유
 *
 * 모델은 **없는 번호를 인용한다.** 「[3] 에 따르면」 이라고 썼는데 컨텍스트에 3번이 없으면,
 * 그 문장은 근거가 있는 것처럼 보이지만 근거가 없다. 그런 문장이 가장 위험하다 —
 * 사용자가 확인하려고 눌렀다가 아무 데도 안 가면 그제야 알게 된다.
 *
 * 그래서 **매칭 안 되는 인용 태그는 지운다.** 문장은 남긴다 — 문장까지 지우면
 * 맞는 내용도 함께 사라진다.
 */

import type { ContextChunk } from './retrieve.ts'

/** 인용 태그 모양 — 컨텍스트를 [1|chunkKey] 로 넘기고 모델은 [1] 로 인용한다 */
const CITE_RE = /\[(\d{1,2})\]/g

export interface CitationCheck {
  /** 태그를 정리한 답변 */
  text: string
  /** 실제로 쓰인 청크들 */
  used: ContextChunk[]
  /** 컨텍스트에 없어서 지운 번호들 */
  dropped: number[]
}

/**
 * 인용 태그를 검사하고 다듬는다.
 *
 * 번호는 1부터 시작한다(모델에게 그렇게 준다).
 */
export function checkCitations(answer: string, chunks: readonly ContextChunk[]): CitationCheck {
  const used = new Map<number, ContextChunk>()
  const dropped = new Set<number>()

  const text = answer.replace(CITE_RE, (whole, num) => {
    const idx = Number(num)
    const chunk = chunks[idx - 1]
    if (!chunk) {
      // 근거가 있는 것처럼 보이지만 없는 문장이 가장 위험하다
      dropped.add(idx)
      return ''
    }
    used.set(idx, chunk)
    return whole
  })

  return {
    // 태그를 지우면서 생긴 공백을 정리한다. 문장은 남긴다
    text: text.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,])/g, '$1').trim(),
    used: Array.from(used.values()),
    dropped: Array.from(dropped).sort((a, b) => a - b),
  }
}

export interface AssistantAnswer {
  text: string
  citations: { index: number; chunkKey: string; caseId: string; blockIds: string[] }[]
  /** 등급 때문에 뺀 문서가 있었나 */
  droppedForClass: number
  /** 없는 번호를 인용한 횟수 — 많으면 프롬프트를 고쳐야 한다 */
  droppedCitations: number
  modelId: string
  notice: string
}

/** AI 기본법 투명성 의무 — 어시스턴트 답변에도 붙는다 */
export const AI_NOTICE = 'AI 생성 결과, 검토 필요'

export function buildAnswer(
  raw: string,
  chunks: readonly ContextChunk[],
  modelId: string,
  droppedForClass: number,
): AssistantAnswer {
  const checked = checkCitations(raw, chunks)
  const indexOf = new Map(chunks.map((c, i) => [c.chunkKey, i + 1]))

  return {
    text: checked.text,
    citations: checked.used.map((c) => ({
      index: indexOf.get(c.chunkKey) ?? 0,
      chunkKey: c.chunkKey,
      caseId: c.caseId,
      blockIds: c.blockIds,
    })),
    droppedForClass,
    droppedCitations: checked.dropped.length,
    modelId,
    notice: AI_NOTICE,
  }
}

/** 답변 프롬프트 — 없는 번호를 인용하지 말라고 적되, 검사는 코드가 한다 */
export function buildAnswerInstruction(): string {
  return [
    '아래 자료만 근거로 답한다. 자료에 없는 내용을 만들지 않는다.',
    '근거를 댈 때는 자료 번호를 [1] 처럼 적는다. 번호는 자료에 있는 것만 쓴다.',
    '자료로 답할 수 없으면 「자료에서 찾지 못했다」고 적는다.',
  ].join('\n')
}
