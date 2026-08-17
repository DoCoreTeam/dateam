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

import { IDENTITY_ASK_AGREEMENT, type ChannelIdentity } from './channel-identity.ts'
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
  /**
   * 이 이름이 어느 축에서, 얼마나 강한 근거로 나왔는지.
   *
   * 왜 필요한가: 채널명과 건수만 있으면 사용자는 **확인**이 아니라 **받아쓰기**를 한다.
   * (G3 지적: reason이 "추성훈 — 게시물 311건"인데 왜 그 이름인지가 없어, 이 기능의 취지인
   *  "사용자는 주제를 만드는 게 아니라 확인한다"에 못 미친다.)
   * 여러 채널이 한 주제로 합쳐질 때는 **콘텐츠가 가장 많은 채널의 근거**를 쓴다 — 그 채널이
   * 이 주제로 들어올 게시물 대부분을 만들기 때문이다.
   */
  basis: {
    kind: 'signal' | 'category'
    label: string
    /** 그 축이 표본에서 차지한 비율(0~1) */
    ratio: number
  }
}

export interface ProposalResult {
  proposals: TopicProposal[]
  /** 신호가 없어 어디에도 못 넣은 채널 */
  unassigned: { channelId: string; displayName: string | null; contentCount: number }[]
}

/**
 * 신호가 채널을 대표한다고 인정하는 최소 지배력.
 *
 * 왜 필요한가: 이게 없으면 **소수 신호가 채널 전체를 대표한다.**
 * (실측: 추성훈 채널 311건 중 '음식' 신호는 71건(23%)뿐인데 채널 이름이 '음식'이 되고,
 *  그 주제가 311건 전부에 붙었다 — 이름만 '요리'에서 '음식'으로 바뀐 셈이었다.)
 * 절반을 넘지 못하는 신호는 그 채널의 성격이 아니라 그 채널이 다루는 **여러 소재 중 하나**다.
 */
const SIGNAL_DOMINANCE_MIN = 0.5

/**
 * 카테고리로 채널을 대표하려면 이만큼은 같은 카테고리여야 한다.
 *
 * 값을 새로 정하지 않고 채널 정체성 판정의 임계를 그대로 쓴다 —
 * "채널 성격을 물어볼 만하다"고 본 수준(IDENTITY_ASK_AGREEMENT)보다 낮은 일치도로
 * 주제를 제안하면, 정체성 쪽은 "모르겠다"는데 제안 쪽은 이름을 붙이는 모순이 생긴다.
 * 숫자를 여기 다시 적으면 한쪽만 고쳐져 두 판정이 갈린다.
 */
const CATEGORY_AGREEMENT_MIN = IDENTITY_ASK_AGREEMENT

/**
 * 채널 정체성들을 모아 주제 후보를 만든다.
 *
 * **주제는 하나의 축에서만 나오고, 규칙도 그 축만 쓴다.**
 * 축을 섞으면 이름과 규칙이 다른 것을 가리킨다 — 실측 사고가 정확히 그것이었다:
 * 이름은 신호('음식')에서, 규칙은 카테고리('인물·블로그' 전체)에서 와서
 * 브이로그·반려동물·여행 영상이 전부 '음식'이 됐다.
 *
 * ① 구체 신호가 채널을 지배하면(과반) → 신호 주제. 규칙은 그 신호 하나.
 * ② 아니면 카테고리 일치도가 높으면 → 카테고리 주제. 규칙은 그 카테고리 하나.
 * ③ 둘 다 아니면 제안하지 않는다 — 억지로 묶는 것이 이 사고의 시작이다.
 */
export function proposeTopics(channels: readonly ChannelForProposal[]): ProposalResult {
  const buckets = new Map<string, TopicProposal>()
  const unassigned: ProposalResult['unassigned'] = []
  /** 근거를 제공한 채널의 콘텐츠 수 — 더 큰 채널이 오면 근거를 그쪽으로 넘긴다 */
  const basisWeight = new Map<string, number>()

  for (const ch of channels) {
    const id = ch.identity

    // ① 구체 신호 중 지배적인 것 — 표본의 절반을 넘어야 "이 채널은 그것"이라 말할 수 있다
    const dominant = id.sampleSize > 0
      ? id.topSignals.find((s) =>
        !isGenericSignal(s.label) && s.count / id.sampleSize >= SIGNAL_DOMINANCE_MIN)
      : undefined

    // ② 지배적 신호가 없으면 카테고리로 — 이때 이름도 규칙도 카테고리다
    const useCategory = !dominant
      && Boolean(id.dominantCategory)
      && Boolean(id.dominantCategoryLabel)
      && id.categoryAgreement >= CATEGORY_AGREEMENT_MIN

    const name = dominant?.label ?? (useCategory ? id.dominantCategoryLabel : null)

    if (!name || id.sampleSize === 0) {
      unassigned.push({
        channelId: ch.channelId,
        displayName: ch.displayName,
        contentCount: ch.contentCount,
      })
      continue
    }

    const existing = buckets.get(name)
    // 규칙은 **이름을 만든 축 하나만**. 다른 신호를 함께 넣으면 그 신호를 가진 게시물까지
    // 이 주제로 빨려 들어온다(실측: '음식' 규칙에 반려동물·여행이 들어가 강아지 영상이 음식이 됐다).
    const signalPatterns = dominant ? [dominant.label] : []
    const categoryPatterns = dominant ? [] : (id.dominantCategory ? [id.dominantCategory] : [])
    const basis: TopicProposal['basis'] = dominant
      ? { kind: 'signal', label: dominant.label, ratio: dominant.count / id.sampleSize }
      : { kind: 'category', label: name, ratio: id.categoryAgreement }

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
      // 근거는 이 주제로 게시물을 가장 많이 보내는 채널의 것으로 유지한다
      if (ch.contentCount > (basisWeight.get(name) ?? -1)) {
        existing.basis = basis
        basisWeight.set(name, ch.contentCount)
      }
    } else {
      buckets.set(name, {
        name,
        channelIds: [ch.channelId],
        channelNames: ch.displayName ? [ch.displayName] : [],
        contentCount: ch.contentCount,
        // 비어 있으면 비운 채로 둔다. 예전엔 `[name]`으로 채웠는데, 카테고리가 이름을 만든
        // 주제에 이름을 신호 규칙으로 붙이는 것이라 **이름과 다른 축의 규칙**이 됐다.
        // 규칙이 하나도 없는 주제는 여기서 나오지 않는다 — 두 축 중 하나는 항상 채워진다.
        signalPatterns,
        categoryPatterns,
        reason: '',
        basis,
      })
      basisWeight.set(name, ch.contentCount)
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
  // 근거를 함께 적는다 — 채널명과 건수만 있으면 사용자는 확인이 아니라 받아쓰기를 한다.
  const pct = Math.round(p.basis.ratio * 100)
  const why = p.basis.kind === 'signal'
    ? `게시물 신호 '${p.basis.label}'이 ${pct}%`
    : `채널 분류 '${p.basis.label}'이 ${pct}%`
  return `${chPart} — 게시물 ${p.contentCount}건 · ${why}`
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

// 예전엔 여기에 excludeExisting(같은 이름의 주제가 있으면 제안을 뺀다)이 있었다.
// 삭제했다 — 이름으로 거르면 "주제는 있는데 채널이 안 붙은" 상태에서 제안이 0개가 되어
// 사용자가 화면에서 고칠 길이 사라진다(실측). 거르는 기준은 호출자(propose GET)가
// **채널에 주제가 붙었는가**로 판단한다. 같은 이름 주제를 둘 만들지 않는 일은
// propose POST가 기존 주제를 재사용하는 것으로 지킨다.
