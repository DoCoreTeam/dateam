// lib/ci/analysis/topic-proposal.ts — 주제 체계를 데이터에서 끌어올린다 (SSOT)
//
// 왜: 온보딩이 빈칸을 주고 "주제를 만드세요"라고 했다. 사용자는 '요리' 하나를 넣었고,
//   시스템은 그때부터 세상을 그 하나로 봤다. 사람이 맨손으로 분류 체계를 설계할 이유가 없다 —
//   채널을 등록하는 순간 플랫폼이 이미 답을 주고 있기 때문이다.
//
// 바뀐 것: 사용자는 주제를 **만드는 게 아니라 확인**한다.
//   "음악 3채널 8건 · 먹방·여행 1채널 311건으로 보입니다. 이대로 만들까요?"
//
// 이 파일도 순수 계산이다. DB·AI를 부르지 않는다.

import type { ChannelIdentity } from './channel-identity.ts'
import { isGenericSignal } from './signal-taxonomy.ts'

export interface ChannelForProposal {
  channelId: string
  displayName: string | null
  contentCount: number
  identity: ChannelIdentity
}

export interface TopicProposal {
  /** 제안 이름. 사용자가 고칠 수 있다 */
  name: string
  /** 이 주제로 묶이는 채널 */
  channelIds: string[]
  channelNames: string[]
  /** 이 주제로 들어올 콘텐츠 수 */
  contentCount: number
  /** 자동 생성될 신호 규칙 */
  signalPatterns: string[]
  categoryPatterns: string[]
  /** 왜 이렇게 묶었는지 — 화면에 그대로 뜬다 */
  reason: string
}

export interface ProposalResult {
  proposals: TopicProposal[]
  /** 신호가 없어 어디에도 못 넣은 채널 */
  unassigned: { channelId: string; displayName: string | null; contentCount: number }[]
}

/**
 * 채널 정체성들을 모아 주제 후보를 만든다.
 *
 * 묶는 기준은 **대표 신호**다. 카테고리로만 묶으면 YouTube의 '인물·블로그'(22)처럼
 * 성격이 다른 채널이 전부 한 덩어리가 된다 — 그건 지금 모든 게 '요리'인 것과 같은 실패다.
 * 그래서 구체 신호를 먼저 쓰고, 구체 신호가 없을 때만 카테고리로 내려간다.
 */
export function proposeTopics(channels: readonly ChannelForProposal[]): ProposalResult {
  const buckets = new Map<string, TopicProposal>()
  const unassigned: ProposalResult['unassigned'] = []

  for (const ch of channels) {
    const id = ch.identity
    // 구체 신호 → 범용 신호 → 카테고리 순으로 이름을 찾는다
    const specific = id.topSignals.find((s) => !isGenericSignal(s.label))?.label ?? null
    const name = specific ?? id.dominantCategoryLabel ?? id.topSignals[0]?.label ?? null

    if (!name || id.sampleSize === 0) {
      unassigned.push({
        channelId: ch.channelId,
        displayName: ch.displayName,
        contentCount: ch.contentCount,
      })
      continue
    }

    const existing = buckets.get(name)
    const signalPatterns = id.topSignals
      .filter((s) => !isGenericSignal(s.label))
      .slice(0, 4)
      .map((s) => s.label)
    const categoryPatterns = id.dominantCategory ? [id.dominantCategory] : []

    if (existing) {
      existing.channelIds.push(ch.channelId)
      if (ch.displayName) existing.channelNames.push(ch.displayName)
      existing.contentCount += ch.contentCount
      for (const p of signalPatterns) {
        if (!existing.signalPatterns.includes(p)) existing.signalPatterns.push(p)
      }
      for (const p of categoryPatterns) {
        if (!existing.categoryPatterns.includes(p)) existing.categoryPatterns.push(p)
      }
    } else {
      buckets.set(name, {
        name,
        channelIds: [ch.channelId],
        channelNames: ch.displayName ? [ch.displayName] : [],
        contentCount: ch.contentCount,
        signalPatterns: signalPatterns.length > 0 ? signalPatterns : [name],
        categoryPatterns,
        reason: '',
      })
    }
  }

  const proposals = Array.from(buckets.values())
    .map((p) => ({
      ...p,
      reason: buildReason(p),
    }))
    .sort((a, b) => b.contentCount - a.contentCount)

  return { proposals, unassigned }
}

function buildReason(p: TopicProposal): string {
  const chPart = p.channelNames.length > 0
    ? `${p.channelNames.slice(0, 3).join(', ')}${p.channelNames.length > 3 ? ` 외 ${p.channelNames.length - 3}곳` : ''}`
    : `채널 ${p.channelIds.length}곳`
  return `${chPart} — 게시물 ${p.contentCount}건`
}

/**
 * 제안을 사람이 읽는 한 문장으로.
 * 온보딩 카드가 이 문장을 그대로 쓴다.
 */
export function describeProposals(r: ProposalResult): string {
  if (r.proposals.length === 0) {
    return '아직 주제를 제안할 만큼 신호가 모이지 않았습니다'
  }
  const head = r.proposals
    .slice(0, 4)
    .map((p) => `${p.name} ${p.channelIds.length}채널 ${p.contentCount}건`)
    .join(' · ')
  const tail = r.unassigned.length > 0 ? ` (신호 없음 ${r.unassigned.length}채널)` : ''
  return head + tail
}

/**
 * 기존 주제와 겹치는 제안은 뺀다.
 * 이름이 같으면 이미 있는 것이다 — 같은 이름의 주제를 두 개 만들면 분류가 갈린다.
 */
export function excludeExisting(
  r: ProposalResult,
  existingNames: readonly string[],
): ProposalResult {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()))
  return {
    proposals: r.proposals.filter((p) => !taken.has(p.name.trim().toLowerCase())),
    unassigned: r.unassigned,
  }
}
