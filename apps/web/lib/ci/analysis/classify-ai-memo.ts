// lib/ci/analysis/classify-ai-memo.ts — 분류 AI 답을 입력 지문과 함께 남긴다 (순수 계산)
//
// ## 무엇을 푸는가
//
// 분류는 규칙이 애매할 때만 AI 에 묻는다. 그런데 콘텐츠를 다시 수집할 때마다 분류가 다시 돌고,
// 입력이 한 글자도 안 바뀐 콘텐츠를 또 물었다.
// 실측 2026-10-29 최근 7일: 분류가 콘텐츠 193건에 414번 돌았고 새 콘텐츠는 67건이었다.
//
// ## 무엇을 지문에 넣나
//
// **보낸 프롬프트 글자 전체와 모델.** 프롬프트에는 제목 설명 채널 맥락 신호 영상 근거
// 그리고 사람이 고친 예시까지 다 들어 있다. 그중 하나라도 바뀌면 지문이 달라져 다시 묻는다.
// 질문이 같고 모델이 같으면 답이 같다고 본다 (temperature 0 호출이다).
//
// ## 무엇을 남기지 않나
//
// 실패한 호출과 형식이 깨진 답. 남기면 한 번 실패한 콘텐츠를 영영 안 묻는다.
// 원문 프롬프트도 안 남긴다. 지문은 해시라 콘텐츠 칸에 글을 더 싣지 않는다.

import { createHash } from 'node:crypto'

export interface ClassifyAiAnswer {
  topicId: string | null
  confidence: number
  reason: string
}

export interface ClassifyAiMemo extends ClassifyAiAnswer {
  key: string
}

/** topic_basis 안에서 쓰는 자리 이름 */
export const AI_MEMO_FIELD = 'aiMemo'

export function classifyAiKey(prompt: string, model: string): string {
  return createHash('sha256').update(`${model}\n${prompt}`).digest('hex')
}

/**
 * 전에 같은 질문에 받은 답. 없거나 지문이 다르거나 모양이 깨졌으면 null.
 * 주제 목록이 바뀌어 남은 주제 id 가 이제 없는 주제면 쓰지 않는다.
 */
export function readClassifyAiMemo(
  topicBasis: unknown, key: string, validTopicIds: readonly string[],
): ClassifyAiAnswer | null {
  if (!topicBasis || typeof topicBasis !== 'object') return null
  const memo = (topicBasis as Record<string, unknown>)[AI_MEMO_FIELD]
  if (!memo || typeof memo !== 'object') return null
  const m = memo as Record<string, unknown>
  if (m.key !== key) return null
  const topicId = typeof m.topicId === 'string' ? m.topicId : null
  if (topicId !== null && !validTopicIds.includes(topicId)) return null
  if (typeof m.confidence !== 'number' || typeof m.reason !== 'string') return null
  return { topicId, confidence: m.confidence, reason: m.reason }
}

export function toClassifyAiMemo(key: string, answer: ClassifyAiAnswer): ClassifyAiMemo {
  return { key, topicId: answer.topicId, confidence: answer.confidence, reason: answer.reason }
}
