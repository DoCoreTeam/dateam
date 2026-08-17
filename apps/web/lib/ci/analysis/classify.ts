// lib/ci/analysis/classify.ts — 주제 분류 판정 사다리 (설계서 §11.5)
//
// 사다리는 L0 플랫폼 신호 → L1 채널 정체성 → L2 텍스트 규칙 → L3 AI → L4 사람 순이다.
// **각 단은 서로 다른 증거를 본다.** 이것이 이 파일의 유일한 설계 원칙이다.
//
// 예전에는 1차 규칙과 2차 AI가 **같은 입력(제목+설명)** 을 봤다. 같은 증거를 두 번 보면
// 두 번째는 첫 번째를 이길 수 없고, 그래서 2단 깔때기가 사실상 1단이었다.
// 게다가 "주제가 하나뿐이면 그것으로 둔다"는 콜드스타트 조항이 있어, 주제가 하나인 동안은
// 판정 자체가 일어나지 않았다 — 실측 305건이 그 조항이 찍은 confidence 0.55였다.
// (진단: docs/2026-08-17-ci-topic-classification-replan/00-REPORT.md)

import type { CiTopicSource } from '../types.ts'
import {
  type ChannelIdentity, type ChannelSignalSample,
  detectDivergence, describeSample,
} from './channel-identity.ts'
import { foldSignals, signalLabel } from './signal-taxonomy.ts'

export interface TopicCandidate {
  id: string
  name: string
  /** 제목·설명에서 찾을 문자열 */
  includePatterns: string[]
  excludePatterns: string[]
  /** topic_signals와 맞춰볼 값. 한국어 이름('음악') 또는 원문('Music') 둘 다 허용 */
  signalPatterns: string[]
  /** platform_category 원문 코드('10') */
  categoryPatterns: string[]
}

export interface ClassifyInput {
  title: string | null
  caption: string | null
  /** 채널이 확정한 주제 (L1 결과) */
  channelTopicId: string | null
  /** 채널 주제의 확신도. 사람이 확정했으면 1 */
  channelTopicConfidence?: number | null
  /** 채널 정체성 집계 (L1). 없으면 이탈 판정을 하지 않는다 */
  channelIdentity?: ChannelIdentity | null
  /** 이 콘텐츠의 플랫폼 신호 (L0) */
  signals?: ChannelSignalSample | null
  platform?: string
  topics: TopicCandidate[]
}

/** 사다리 각 단이 남긴 기록. 화면이 사용자에게 그대로 보여준다. */
export interface BasisRung {
  level: 'L0' | 'L1' | 'L2' | 'L3'
  ok: boolean
  detail: string
}

export interface ClassifyVerdict {
  topicId: string | null
  /** 부 주제 — 신호가 여러 주제를 가리킬 때. 통계에는 안 쓰고 검색·필터에만 쓴다 */
  secondaryTopicIds: string[]
  confidence: number
  source: CiTopicSource
  /** 한 문장 근거 */
  reason: string
  /** 단계별 기록 */
  rungs: BasisRung[]
  /** 사람에게 물어야 하는가. 이것이 true일 때만 검토 큐로 간다 */
  needsHuman: boolean
}

function norm(s: string | null): string {
  return (s ?? '').toLowerCase()
}

function countMatches(text: string, patterns: readonly string[]): number {
  let hits = 0
  for (const p of patterns) {
    const needle = p.trim().toLowerCase()
    if (needle && text.includes(needle)) hits++
  }
  return hits
}

/** 신호 목록이 주제의 신호 규칙에 걸리는지. 원문·한국어 이름 양쪽으로 맞춰본다. */
function signalHits(signals: readonly string[], patterns: readonly string[]): number {
  if (patterns.length === 0 || signals.length === 0) return 0
  const pool = new Set<string>()
  for (const s of signals) {
    pool.add(s.toLowerCase())
    pool.add(signalLabel(s).toLowerCase())
  }
  let hits = 0
  for (const p of patterns) {
    const needle = p.trim().toLowerCase()
    if (needle && pool.has(needle)) hits++
  }
  return hits
}

function emptyVerdict(reason: string, rungs: BasisRung[], needsHuman: boolean): ClassifyVerdict {
  return {
    topicId: null,
    secondaryTopicIds: [],
    confidence: 0,
    source: 'auto',
    reason,
    rungs,
    needsHuman,
  }
}

/**
 * 사다리 L0~L2를 순서대로 밟는다. AI(L3)는 부르지 않는다 — 부를지 말지는 호출부가 정한다.
 *
 * 판정이 나오는 자리는 세 곳이고, 각각 보는 증거가 다르다.
 *   L0  이 게시물의 플랫폼 신호가 어떤 주제의 신호 규칙에 맞는가
 *   L2  제목·설명이 어떤 주제의 텍스트 규칙에 맞는가
 *   L1  (위 둘이 안 되면) 이 채널이 확정한 주제를 상속한다
 */
export function classifyByRules(input: ClassifyInput): ClassifyVerdict {
  const rungs: BasisRung[] = []
  const topics = input.topics
  const platform = input.platform ?? 'youtube'

  if (topics.length === 0) {
    return emptyVerdict('워크스페이스에 주제가 없습니다', rungs, false)
  }

  // ── L0 · 플랫폼 신호 ──────────────────────────────────────────
  const sig = input.signals
  const mySignals = sig ? foldSignals(sig.topicSignals) : []
  let l0: { topic: TopicCandidate; score: number } | null = null
  const l0Others: TopicCandidate[] = []

  if (sig) {
    for (const t of topics) {
      const bySignal = signalHits(sig.topicSignals, t.signalPatterns)
      const byCategory = sig.platformCategory && t.categoryPatterns.includes(sig.platformCategory) ? 1 : 0
      const total = bySignal + byCategory
      if (total === 0) continue
      // 카테고리와 신호가 함께 맞으면 가장 강한 증거다
      const score = bySignal > 0 && byCategory > 0 ? 0.92 : (bySignal >= 2 ? 0.88 : 0.82)
      if (!l0 || score > l0.score) {
        if (l0) l0Others.push(l0.topic)
        l0 = { topic: t, score }
      } else l0Others.push(t)
    }
    rungs.push({
      level: 'L0',
      ok: l0 != null,
      detail: l0
        ? `플랫폼 신호가 '${l0.topic.name}'을 가리킵니다 — ${describeSample(platform, sig)}`
        : (mySignals.length > 0 || sig.platformCategory
          ? `플랫폼 신호(${describeSample(platform, sig)})에 맞는 주제 규칙이 없습니다`
          : '플랫폼이 주제 신호를 주지 않았습니다'),
    })
  } else {
    rungs.push({ level: 'L0', ok: false, detail: '플랫폼 신호가 아직 수집되지 않았습니다' })
  }

  // ── L2 · 텍스트 규칙 ──────────────────────────────────────────
  const text = `${norm(input.title)} ${norm(input.caption)}`
  let l2: { topic: TopicCandidate; score: number } | null = null
  let l2Tie = false

  for (const t of topics) {
    if (countMatches(text, t.excludePatterns) > 0) continue
    const hits = countMatches(text, t.includePatterns)
    if (hits === 0) continue
    const score = hits >= 3 ? 0.9 : hits === 2 ? 0.82 : 0.7
    if (!l2 || score > l2.score) { l2 = { topic: t, score }; l2Tie = false }
    else if (l2 && score === l2.score) l2Tie = true
  }
  rungs.push({
    level: 'L2',
    ok: l2 != null,
    detail: l2
      ? `제목·설명이 '${l2.topic.name}' 규칙에 맞습니다${l2Tie ? ' (다른 주제와 동점)' : ''}`
      : '제목·설명에서 주제 규칙을 찾지 못했습니다',
  })

  // ── L1 · 채널 정체성 ──────────────────────────────────────────
  const chTopic = input.channelTopicId
    ? topics.find((t) => t.id === input.channelTopicId) ?? null
    : null
  const chConf = input.channelTopicConfidence ?? 0.75
  const divergence = input.channelIdentity && sig
    ? detectDivergence(input.channelIdentity, sig)
    : { diverged: false, reason: '채널 정체성이 아직 없습니다' }

  rungs.push({
    level: 'L1',
    ok: chTopic != null,
    detail: chTopic
      ? `채널 주제는 '${chTopic.name}'입니다${divergence.diverged ? ` — 다만 ${divergence.reason}` : ''}`
      : '이 채널의 주제가 아직 정해지지 않았습니다',
  })

  // ── 판정 조합 ────────────────────────────────────────────────
  //
  // 서로 다른 증거가 같은 답을 내면 강하다. 다른 답을 내면 그때가 사람을 부를 자리다.

  const secondary = new Set<string>()

  // 1) L0과 L2가 같은 주제를 가리킨다 — 가장 강한 자동 확정
  if (l0 && l2 && l0.topic.id === l2.topic.id) {
    return {
      topicId: l0.topic.id,
      secondaryTopicIds: Array.from(secondary),
      confidence: 0.95,
      source: 'auto',
      reason: `플랫폼 신호와 제목이 모두 '${l0.topic.name}'을 가리킵니다`,
      rungs,
      needsHuman: false,
    }
  }

  // 2) L0과 L2가 서로 다른 주제를 가리킨다 — 진짜 애매한 경우다. 사람을 부른다.
  if (l0 && l2 && l0.topic.id !== l2.topic.id) {
    secondary.add(l2.topic.id)
    return {
      topicId: l0.topic.id,
      secondaryTopicIds: Array.from(secondary),
      confidence: 0.6,
      source: 'auto',
      reason: `신호는 '${l0.topic.name}', 제목은 '${l2.topic.name}'을 가리켜 판단이 갈립니다`,
      rungs,
      needsHuman: true,
    }
  }

  // 3) L0만 있다
  if (l0) {
    for (const o of l0Others) secondary.add(o.id)
    const agreesWithChannel = !chTopic || chTopic.id === l0.topic.id
    return {
      topicId: l0.topic.id,
      secondaryTopicIds: Array.from(secondary),
      confidence: agreesWithChannel ? l0.score : Math.min(l0.score, 0.7),
      source: 'auto',
      reason: `플랫폼 신호가 '${l0.topic.name}'을 가리킵니다`,
      rungs,
      // 채널이 다른 주제인데 신호가 어긋나면 이탈이다 — 이때만 묻는다
      needsHuman: !agreesWithChannel && divergence.diverged,
    }
  }

  // 4) L2만 있다
  if (l2) {
    return {
      topicId: l2.topic.id,
      secondaryTopicIds: Array.from(secondary),
      confidence: l2Tie ? 0.6 : l2.score,
      source: 'auto',
      reason: `제목·설명이 '${l2.topic.name}' 규칙에 맞습니다`,
      rungs,
      needsHuman: l2Tie,
    }
  }

  // 5) 채널 주제를 상속한다 — 이탈이 아니면 그대로 따른다
  if (chTopic) {
    if (divergence.diverged) {
      return {
        topicId: chTopic.id,
        secondaryTopicIds: [],
        confidence: 0.5,
        source: 'auto',
        reason: `채널 주제는 '${chTopic.name}'인데 ${divergence.reason}`,
        rungs,
        needsHuman: true,
      }
    }
    return {
      topicId: chTopic.id,
      secondaryTopicIds: [],
      // 채널 확신도를 넘겨받되 상속이므로 한 단계 낮춘다
      confidence: Math.min(0.9, Math.round(chConf * 0.95 * 1000) / 1000),
      source: 'auto',
      reason: `이 채널의 주제 '${chTopic.name}'을 따랐습니다`,
      rungs,
      needsHuman: false,
    }
  }

  // 6) 아무 근거도 없다 — 미분류로 둔다.
  //
  // 예전에는 여기서 "주제가 하나뿐이면 그것으로 둔다"는 조항이 걸려 있었다.
  // 그 한 줄이 305건을 판정 없이 한 주제로 밀어 넣었다. 근거가 없으면 없다고 말한다.
  //
  // 그리고 미분류를 검토 큐로 보내지 않는다(needsHuman=false). 근거가 없는 것은
  // 사람이 봐도 근거가 없다 — 채널 정체성이 서면 그때 상속으로 풀린다.
  return emptyVerdict(
    mySignals.length > 0
      ? `주제 신호(${mySignals.slice(0, 2).join(', ')})가 있지만 맞는 주제가 없습니다`
      : '주제를 판단할 근거를 찾지 못했습니다',
    rungs,
    false,
  )
}

/** 자동 확정 여부. 임계 미달이면 '추정'으로 표시하되 검토 큐로 보내지는 않는다. */
export function shouldAutoConfirm(confidence: number, threshold: number): boolean {
  return confidence >= threshold
}

// ── 표시 구간 (3구간) ────────────────────────────────────────────
//
// "55%"는 사용자에게 아무 의미가 없다. 확정 / 추정 / 미분류 셋으로만 말한다.
// 저장하지 않고 파생한다 — 상태를 따로 저장하면 confidence와 어긋난다.

export type TopicState = 'confirmed' | 'estimated' | 'unclassified'

export function topicState(
  topicId: string | null,
  confidence: number | null,
  source: CiTopicSource,
  threshold: number,
): TopicState {
  if (!topicId) return 'unclassified'
  if (source === 'user') return 'confirmed'
  return (confidence ?? 0) >= threshold ? 'confirmed' : 'estimated'
}

export const TOPIC_STATE_LABEL: Readonly<Record<TopicState, string>> = {
  confirmed: '확정',
  estimated: '추정',
  unclassified: '미분류',
}

// ── L3 · AI 판정 ────────────────────────────────────────────────

export interface ClassifyPromptInput {
  title: string | null
  caption: string | null
  topics: { id: string; name: string }[]
  /** 채널 맥락 — 예전 프롬프트에는 이것이 통째로 빠져 있었다 */
  channel?: {
    name: string | null
    description: string | null
    identityText: string | null
  } | null
  /** 이 게시물의 플랫폼 신호를 사람 말로 옮긴 것 */
  signalText?: string | null
  correctionExamples?: readonly string[]
}

/**
 * 2차 AI 판정 프롬프트.
 *
 * 예전에는 제목·설명·주제이름만 넘겼다. 그래서 AI도 규칙과 **같은 것을 보고** 같은 답을 냈다.
 * 지금은 채널이 무엇인지, 플랫폼이 뭐라고 하는지를 함께 넘긴다 — 이것이 2단을 2단으로 만든다.
 */
export function buildClassifyPrompt(input: ClassifyPromptInput): string {
  const list = input.topics.map((t) => `- ${t.name} (id: ${t.id})`).join('\n')
  const examples = input.correctionExamples ?? []
  const ch = input.channel

  return [
    '아래 콘텐츠가 어떤 주제에 속하는지 판단해 주세요.',
    '',
    ...(ch ? [
      '[채널 정보]',
      `채널명: ${ch.name ?? '(모름)'}`,
      ...(ch.description ? [`채널 소개: ${ch.description.slice(0, 400)}`] : []),
      ...(ch.identityText ? [`채널 성격(신호 집계): ${ch.identityText}`] : []),
      '',
    ] : []),
    '[게시물]',
    `제목: ${input.title ?? '(없음)'}`,
    `설명: ${(input.caption ?? '(없음)').slice(0, 800)}`,
    ...(input.signalText ? [`플랫폼이 준 주제 신호: ${input.signalText}`] : []),
    '',
    '후보 주제:',
    list,
    ...(examples.length > 0 ? [
      '',
      '이 조직이 지금까지 직접 고친 사례입니다. 같은 성격이면 이 판단을 따르세요.',
      ...examples,
    ] : []),
    '',
    '다음 JSON만 출력하세요. 다른 문장은 넣지 마세요.',
    '{"topicId": "후보 중 하나의 id 또는 null", "confidence": 0.0~1.0, "reason": "한 문장 근거"}',
    '',
    '판단 지침:',
    '- 채널 성격과 게시물 신호를 함께 보세요. 제목만으로 단정하지 마세요.',
    '- 확실하지 않으면 confidence를 낮게 주고 topicId를 null로 두세요. 억지로 고르지 마세요.',
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

/**
 * AI를 부를 가치가 있는가.
 *
 * 후보 주제가 1개 이하면 부르지 않는다 — "요리인가 아닌가"를 물으면서 정답지에
 * 요리만 놓는 셈이라, AI가 무엇을 답해도 정보가 늘지 않는다.
 * 실측에서 이 상태로 15건을 호출했고 15건 모두 같은 답이 나왔다.
 */
export function shouldCallAi(topicCount: number, verdict: ClassifyVerdict, threshold: number): boolean {
  if (topicCount < 2) return false
  if (shouldAutoConfirm(verdict.confidence, threshold)) return false
  return true
}
