// lib/ci/analysis/classify.ts — 주제 분류 (설계서 §11.5 깔때기)
// 1차 규칙·키워드 → 2차 LLM 판정(저확신 구간만) → 미달분만 검토 큐.
// 전량 LLM은 비용상 불가능하므로 1차에서 최대한 걸러낸다.

import type { CiTopicSource } from '../types.ts'

export interface TopicCandidate {
  id: string
  name: string
  /** 포함 규칙(있으면 우선) */
  includePatterns: string[]
  excludePatterns: string[]
}

export interface ClassifyInput {
  title: string | null
  caption: string | null
  channelTopicId: string | null
  topics: TopicCandidate[]
}

export interface ClassifyVerdict {
  topicId: string | null
  confidence: number
  source: CiTopicSource
  /** 왜 이렇게 판정했는지 — 검토 큐 카드에 붙는다 */
  reason: string
}

function norm(s: string | null): string {
  return (s ?? '').toLowerCase()
}

function matches(text: string, patterns: string[]): number {
  let hits = 0
  for (const p of patterns) {
    const needle = p.trim().toLowerCase()
    if (needle && text.includes(needle)) hits++
  }
  return hits
}

/**
 * 1차 분류 — 규칙과 채널 귀속만으로 판정한다. LLM을 부르지 않는다.
 *
 * 확신도 산정:
 *  - 제외 규칙에 걸리면 그 주제는 후보에서 빠진다
 *  - 포함 규칙 적중 수가 많을수록 높다
 *  - 규칙이 없으면 채널에 지정된 주제를 약한 근거로 쓴다
 */
export function classifyByRules(input: ClassifyInput): ClassifyVerdict {
  const text = `${norm(input.title)} ${norm(input.caption)}`

  let best: { topic: TopicCandidate; score: number } | null = null

  for (const t of input.topics) {
    if (matches(text, t.excludePatterns) > 0) continue
    const hits = matches(text, t.includePatterns)
    if (hits === 0) continue
    // 적중 1개=0.7, 2개=0.85, 3개 이상=0.95
    const score = hits >= 3 ? 0.95 : hits === 2 ? 0.85 : 0.7
    if (!best || score > best.score) best = { topic: t, score }
  }

  if (best) {
    return {
      topicId: best.topic.id,
      confidence: best.score,
      source: 'auto',
      reason: `주제 규칙에 ${best.score >= 0.85 ? '여러 개' : '하나'} 일치했습니다`,
    }
  }

  if (input.channelTopicId) {
    return {
      topicId: input.channelTopicId,
      confidence: 0.6,
      source: 'auto',
      reason: '채널에 지정된 주제를 따랐습니다 (본문에서 근거를 찾지 못했습니다)',
    }
  }

  // 주제가 딱 하나뿐인 워크스페이스라면 그것으로 본다 — 콜드 스타트 구간 배려
  if (input.topics.length === 1) {
    return {
      topicId: input.topics[0].id,
      confidence: 0.55,
      source: 'auto',
      reason: '워크스페이스에 주제가 하나뿐이라 그것으로 두었습니다',
    }
  }

  return {
    topicId: null,
    confidence: 0,
    source: 'auto',
    reason: '본문에서 주제를 판단할 근거를 찾지 못했습니다',
  }
}

/** 자동 확정 여부. 임계 미달이면 검토 큐로 간다. */
export function shouldAutoConfirm(confidence: number, threshold: number): boolean {
  return confidence >= threshold
}

/**
 * 2차 LLM 판정에 넘길 프롬프트.
 * 사용자가 최종 심판이지 분류 노동자가 아니므로, AI가 근거를 먼저 만들어 붙인다.
 */
export function buildClassifyPrompt(input: {
  title: string | null
  caption: string | null
  topics: { id: string; name: string }[]
}): string {
  const list = input.topics.map((t) => `- ${t.name} (id: ${t.id})`).join('\n')
  return [
    '아래 콘텐츠가 어떤 주제에 속하는지 판단해 주세요.',
    '',
    `제목: ${input.title ?? '(없음)'}`,
    `설명: ${(input.caption ?? '(없음)').slice(0, 800)}`,
    '',
    '후보 주제:',
    list,
    '',
    '다음 JSON만 출력하세요. 다른 문장은 넣지 마세요.',
    '{"topicId": "후보 중 하나의 id 또는 null", "confidence": 0.0~1.0, "reason": "한 문장 근거"}',
    '',
    '확실하지 않으면 confidence를 낮게 주고 topicId를 null로 두세요. 억지로 고르지 마세요.',
  ].join('\n')
}

export interface LlmVerdict {
  topicId: string | null
  confidence: number
  reason: string
}

/** LLM 응답 파싱. 형식이 깨지면 판정하지 않는다(억지로 해석하지 않는다). */
export function parseLlmVerdict(raw: string, validIds: readonly string[]): LlmVerdict | null {
  const m = /\{[\s\S]*\}/.exec(raw)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>
    const topicId = typeof j.topicId === 'string' && validIds.includes(j.topicId) ? j.topicId : null
    const confidence = typeof j.confidence === 'number' && j.confidence >= 0 && j.confidence <= 1
      ? j.confidence : 0
    const reason = typeof j.reason === 'string' ? j.reason : 'AI 판정'
    return { topicId, confidence, reason }
  } catch {
    return null
  }
}
