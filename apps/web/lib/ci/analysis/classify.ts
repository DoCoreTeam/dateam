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
import { discriminatingSample, describeDiscrimination, stripBoilerplate } from './signal-discrimination.ts'

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
  /**
   * 사람이 «이 채널의 게시물은 이 주제»라고 답해 굳힌 값(마이그 226).
   *
   * 왜 필요한가: 채널 고정 태그가 게시물마다 같은 신호를 내면 L0(신호)와 L2(제목)가
   * 매번 같은 자리에서 갈린다 — 실측 634건 중 629건이 그렇게 한 채널에서 나왔다.
   * 사람이 한 번 답했으면 그 채널은 다시 묻지 않는다.
   */
  channelContentTopicId?: string | null
  /** 채널이 확정한 주제 (L1 결과) */
  channelTopicId: string | null
  /** 채널 주제의 확신도. 사람이 확정했으면 1 */
  channelTopicConfidence?: number | null
  /** 채널 정체성 집계 (L1). 없으면 이탈 판정을 하지 않는다 */
  channelIdentity?: ChannelIdentity | null
  /** 이 콘텐츠의 플랫폼 신호 (L0) */
  signals?: ChannelSignalSample | null
  platform?: string
  /**
   * 영상 실체에서 관측된 텍스트 — 대사·화면 자막·장소.
   * lib/ci/media가 채운다. 없으면 이 단(LM)을 밟지 않는다.
   *
   * 이것이 왜 title·caption과 별개인가: 숏폼은 플랫폼이 설명을 주지 않는다
   * (실측 423건 중 227건 설명문 없음). 그동안 L2도 L3도 **같은 빈 상자**를 봤고,
   * 그래서 두 단이 있어도 실제로는 한 단도 없는 것과 같았다.
   */
  mediaText?: string | null
  /** 영상이 스스로 말한 주제 한 단어. 근거(topicEvidence)가 있을 때만 채워진다 */
  mediaTopicGuess?: string | null
  topics: TopicCandidate[]
}

/** 사다리 각 단이 남긴 기록. 화면이 사용자에게 그대로 보여준다. */
export interface BasisRung {
  /** LM = 영상 실체(대사·화면 자막). L2(제목·설명)와 **다른 증거**다 */
  level: 'L0' | 'L1' | 'L2' | 'LM' | 'L3'
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

  // 채널 전체에 똑같이 붙은 신호는 **이 게시물**을 구별하지 못하므로 여기서 뺀다.
  //
  // 그것은 채널을 설명하는 증거이지 게시물을 설명하는 증거가 아니다 — 그리고 채널을
  // 설명하는 일은 이미 L1이 한다. 같은 증거를 두 단이 보면 사다리가 한 단으로 줄어든다
  // (이 파일 첫 줄의 설계 원칙: **각 단은 서로 다른 증거를 본다**).
  //
  // 실측: 이 필터가 없어서 category 22 하나가 645건 전부를 '음식'으로 만들었고,
  // 제목은 게시물마다 다르니 매번 갈려 634건이 검토 대기로 쌓였다.
  const disc = sig ? discriminatingSample(input.channelIdentity, sig) : null
  const useSig = disc ? disc.sample : null

  if (sig && useSig) {
    for (const t of topics) {
      const bySignal = signalHits(useSig.topicSignals, t.signalPatterns)
      const byCategory = useSig.platformCategory && t.categoryPatterns.includes(useSig.platformCategory) ? 1 : 0
      const total = bySignal + byCategory
      if (total === 0) continue
      // 카테고리와 신호가 함께 맞으면 가장 강한 증거다
      const score = bySignal > 0 && byCategory > 0 ? 0.92 : (bySignal >= 2 ? 0.88 : 0.82)
      if (!l0 || score > l0.score) {
        if (l0) l0Others.push(l0.topic)
        l0 = { topic: t, score }
      } else l0Others.push(t)
    }
    const dropNote = disc ? describeDiscrimination(disc) : ''
    const suffix = dropNote ? ` (${dropNote})` : ''
    rungs.push({
      level: 'L0',
      ok: l0 != null,
      detail: l0
        ? `플랫폼 신호가 '${l0.topic.name}'을 가리킵니다 — ${describeSample(platform, sig)}${suffix}`
        : (dropNote
          ? `${dropNote} — 남은 신호로는 주제를 가릴 수 없습니다`
          : (mySignals.length > 0 || sig.platformCategory
            ? `플랫폼 신호(${describeSample(platform, sig)})에 맞는 주제 규칙이 없습니다`
            : '플랫폼이 주제 신호를 주지 않았습니다')),
    })
  } else {
    rungs.push({ level: 'L0', ok: false, detail: '플랫폼 신호가 아직 수집되지 않았습니다' })
  }

  // ── L2 · 텍스트 규칙 ──────────────────────────────────────────
  //
  // 설명문에서 **채널 고정 문구**를 먼저 걷어낸다. 신호에 한 것과 같은 이유다 —
  // 전건에 똑같이 들어 있는 줄은 이 게시물을 구별하지 못한다.
  // (실측: 한 채널의 캡션 645건 중 서로 다른 것이 11개였고, 그 안의 법적 고지에
  //  「비평·패러디·풍자·교육적 설명의 목적」이 있어 전건이 '교육' 규칙에 걸렸다)
  const ownCaption = stripBoilerplate(input.caption, input.channelIdentity?.captionBoilerplate)
  const text = `${norm(input.title)} ${norm(ownCaption)}`
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

  // ── LM · 영상 실체 ───────────────────────────────────────────
  //
  // 제목이 낚시여도, 설명이 비어 있어도, **영상 안에서 실제로 무슨 말이 오갔는지**는 남는다.
  // 숏폼에서 이것이 사실상 유일한 본문이다.
  const mediaText = `${norm(input.mediaText ?? null)} ${norm(input.mediaTopicGuess ?? null)}`.trim()
  let lm: { topic: TopicCandidate; score: number } | null = null
  let lmTie = false

  if (mediaText) {
    for (const t of topics) {
      if (countMatches(mediaText, t.excludePatterns) > 0) continue
      const hits = countMatches(mediaText, t.includePatterns)
      if (hits === 0) continue
      // 제목 규칙(L2)보다 조금 높게 본다 — 제목은 낚시일 수 있지만 영상은 실체다.
      const score = hits >= 3 ? 0.92 : hits === 2 ? 0.85 : 0.75
      if (!lm || score > lm.score) { lm = { topic: t, score }; lmTie = false }
      else if (lm && score === lm.score) lmTie = true
    }
    rungs.push({
      level: 'LM',
      ok: lm != null,
      detail: lm
        ? `영상 내용이 '${lm.topic.name}'을 가리킵니다${lmTie ? ' (다른 주제와 동점)' : ''}`
        : '영상을 읽었지만 맞는 주제 규칙을 찾지 못했습니다',
    })
  } else {
    rungs.push({ level: 'LM', ok: false, detail: '영상 내용을 아직 읽지 않았습니다' })
  }

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

  // ── L1.5 · 사람이 이 채널에 답해 둔 것 ─────────────────────────
  //
  // 어떤 자동 증거보다 앞선다. 사람이 이미 "이 채널의 영상은 이 주제"라고 답했다면
  // 같은 채널의 다음 게시물에 같은 질문을 다시 하는 것은 시스템의 잘못이다.
  // (실측: 이 한 줄이 없어서 한 채널이 629개의 질문이 됐다)
  const contentTopic = input.channelContentTopicId
    ? topics.find((t) => t.id === input.channelContentTopicId) ?? null
    : null

  if (contentTopic) {
    rungs.push({
      level: 'L1',
      ok: true,
      detail: `이 채널의 게시물 주제를 '${contentTopic.name}'으로 정해 두셨습니다`,
    })
    const others = new Set<string>()
    for (const c of [l0, l2, lm]) if (c && c.topic.id !== contentTopic.id) others.add(c.topic.id)
    return {
      topicId: contentTopic.id,
      // 갈린 후보는 버리지 않고 남긴다 — 나중에 마음이 바뀌면 근거가 필요하다
      secondaryTopicIds: Array.from(others),
      confidence: 1,
      source: 'user',
      reason: `이 채널의 게시물 주제로 '${contentTopic.name}'을 정해 두셨습니다`,
      rungs,
      needsHuman: false,
    }
  }

  // ── 판정 조합 ────────────────────────────────────────────────
  //
  // 서로 다른 증거가 같은 답을 내면 강하다. 다른 답을 내면 그때가 사람을 부를 자리다.

  const secondary = new Set<string>()

  // 0) 영상이 말한 것이 있다 — 가장 실체에 가까운 증거이므로 먼저 본다.
  //
  //    LM이 없을 때는 이 블록을 한 줄도 타지 않는다 → 예전 판정이 그대로 보존된다.
  if (lm) {
    const agree = [l0, l2].filter((c) => c && c.topic.id === lm.topic.id).length
    const disagree = [l0, l2].filter((c) => c && c.topic.id !== lm.topic.id)

    // 0-a) 영상이 다른 증거와 같은 답을 냈다 — 가장 강하다
    if (agree > 0) {
      for (const d of disagree) if (d) secondary.add(d.topic.id)
      return {
        topicId: lm.topic.id,
        secondaryTopicIds: Array.from(secondary),
        confidence: agree >= 2 ? 0.97 : 0.95,
        source: 'auto',
        reason: agree >= 2
          ? `영상 내용·플랫폼 신호·제목이 모두 '${lm.topic.name}'을 가리킵니다`
          : `영상 내용과 ${l0 && l0.topic.id === lm.topic.id ? '플랫폼 신호' : '제목'}가 '${lm.topic.name}'으로 일치합니다`,
        rungs,
        needsHuman: false,
      }
    }

    // 0-b) 신호와 제목이 서로 달라 예전에는 **사람을 불렀던** 자리다.
    //      영상이 어느 쪽도 편들지 않고 제3의 답을 냈다면 그건 여전히 사람의 일이다.
    if (l0 && l2 && l0.topic.id !== l2.topic.id) {
      secondary.add(l0.topic.id)
      secondary.add(l2.topic.id)
      return {
        topicId: lm.topic.id,
        secondaryTopicIds: Array.from(secondary).filter((id) => id !== lm.topic.id),
        confidence: 0.6,
        source: 'auto',
        reason: `영상은 '${lm.topic.name}', 신호는 '${l0.topic.name}', 제목은 '${l2.topic.name}'을 가리켜 셋이 갈립니다`,
        rungs,
        needsHuman: true,
      }
    }

    // 0-c) 영상만 있거나, 영상이 하나뿐인 다른 증거와 어긋난다.
    //      어긋날 때 영상을 택하는 이유: 제목은 낚시일 수 있고 설명은 비어 있을 수 있지만
    //      영상 안에서 오간 말은 그 콘텐츠 자체다. 다만 갈렸다는 사실은 사람에게 알린다.
    const other = disagree[0] ?? null
    for (const d of disagree) if (d) secondary.add(d.topic.id)
    return {
      topicId: lm.topic.id,
      secondaryTopicIds: Array.from(secondary),
      confidence: other ? Math.min(lm.score, 0.72) : (lmTie ? 0.65 : lm.score),
      source: 'auto',
      reason: other
        ? `영상 내용은 '${lm.topic.name}'인데 ${l0 === other ? '플랫폼 신호' : '제목'}는 '${other.topic.name}'을 가리킵니다`
        : `영상 내용이 '${lm.topic.name}'을 가리킵니다`,
      rungs,
      needsHuman: Boolean(other) || lmTie,
    }
  }

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

  // 2) L0과 L2가 서로 다른 주제를 가리킨다 — 갈릴 때는 **이 게시물의 제목**을 택한다.
  //
  //    예전에는 신호(L0)를 택했다. 그래서 「김세의 깜빵 두달차」가 '음식'이 됐다 —
  //    신호는 채널 여러 게시물에 걸친 증거이고 제목은 이 게시물만의 증거인데,
  //    갈릴 때 채널 쪽을 택하면 **게시물별 판정이라는 말 자체가 성립하지 않는다.**
  //    LM(영상 실체)이 어긋날 때 영상을 택하는 것(0-c)과 같은 이유다.
  //
  //    다만 갈렸다는 사실은 남기고 사람에게 알린다 — 택한 것이 확정은 아니다.
  if (l0 && l2 && l0.topic.id !== l2.topic.id) {
    secondary.add(l0.topic.id)
    return {
      topicId: l2.topic.id,
      secondaryTopicIds: Array.from(secondary),
      confidence: 0.6,
      source: 'auto',
      reason: `제목은 '${l2.topic.name}', 신호는 '${l0.topic.name}'을 가리켜 판단이 갈립니다`,
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
  /**
   * 영상 안에서 관측된 것 — 대사·화면 자막·장소.
   * 숏폼에서는 제목·설명이 비어 있으므로 **이것이 사실상 유일한 본문**이다.
   */
  mediaText?: string | null
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
    ...(input.mediaText ? [
      '',
      '[영상에서 실제로 관측된 것] — 제목·설명이 비어 있어도 이것은 사실이다',
      input.mediaText.slice(0, 2000),
    ] : []),
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
    '- 영상에서 관측된 것이 있으면 그것을 가장 무겁게 보세요. 제목은 낚시일 수 있지만 영상은 실체입니다.',
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
