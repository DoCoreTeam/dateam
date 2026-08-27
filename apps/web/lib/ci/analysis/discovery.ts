// lib/ci/analysis/discovery.ts — "왜 잘됐나"를 채점이 아니라 발견으로 (patterns.ts 대체)
//
// 왜 갈아엎었나 (실측 2026-08-27):
//   patterns.ts는 규칙 7개(숫자·질문형·괄호·20자·60초·1~3분·주말)를 하드코딩해 두고
//   데이터에 대조해 점수를 매겼다. 그 결과 "성공 공식" 617건이 전부 이 7문장의 중복이었고,
//   효과는 1.21~1.25배 — 근거 104건으로 "통계적으로 확실하게 쓸모없음"을 증명한 상태였다.
//
//   근본 결함은 통계가 아니라 **답의 집합이 7개로 고정됐다**는 것이다.
//   콘텐츠가 잘되는 이유는 소재의 시의성·등장 인물·썸네일의 표정·첫 3초·시리즈 맥락·
//   시장의 공백처럼 미리 적을 수 없는 것들이다. 목록으로 못 적는 것을 목록으로 풀려 했다.
//
// 바뀐 것: **가설을 사람이 미리 적지 않는다. 대조가 이유를 만든다.**
//   ① 같은 채널·같은 포맷·비슷한 시기에서 떡상 1건 vs 평범 3건을 짝짓는다
//   ② AI가 그 4건의 실제 내용을 읽고 "이 1건만 가진 것"을 자유 문장으로 쓴다
//   ③ 서로 다른 채널 3곳 이상에서 반복된 것만 공식으로 승격한다
//
// 채널·시기를 고정하는 것이 핵심이다. 그래야 "이 1건만 다른 것"이 남는다.
// (채널이 다르면 채널 규모가, 시기가 다르면 시즌이 이유로 섞여 들어온다.)
//
// 이 파일은 순수 계산이다. DB·AI를 부르지 않는다.

/** 떡상 판정 하한. 평소 대비 이 배수 이상을 '설명이 필요한 성과'로 본다. */
export const WINNER_MIN_INDEX = 2

/**
 * 평범 판정 구간. 떡상도 실패도 아닌 '이 채널의 보통'.
 *
 * 구간을 좁게 잡으면 대조군을 못 채우고, 넓게 잡으면 준수한 성과까지 평범에 들어가
 * 차이가 흐려진다. 0.6~1.4는 중앙값 ±40%다.
 */
export const PEER_MIN_INDEX = 0.6
export const PEER_MAX_INDEX = 1.4

/** 떡상 1건당 붙일 대조군 수. 1건이면 우연, 3건이면 경향이 보인다. */
export const PEERS_PER_WINNER = 3

/**
 * 대조군을 고를 때 허용하는 시간 거리(일).
 *
 * 이 창을 넘어가면 채널 자체가 달라져 있다(구독자·편집 스타일·알고리즘).
 * 같은 채널이라도 2년 전과는 대조가 성립하지 않는다.
 */
export const PEER_MAX_DAYS_APART = 180

/**
 * 공식으로 승격하는 최소 채널 수.
 *
 * 한 채널에서 3번 반복된 것은 그 채널의 습관이지 시장의 공식이 아니다.
 * **서로 다른** 채널이어야 한다.
 */
export const DISCOVERY_MIN_CHANNELS = 3

/** 승격 최소 근거 수(떡상 건수). 채널 수 조건과 함께 걸린다. */
export const DISCOVERY_MIN_EVIDENCE = 3

export interface DiscoverySample {
  contentId: string
  channelId: string | null
  title: string | null
  caption: string | null
  format: string | null
  durationSec: number | null
  publishedAt: string | null
  thumbnailUrl: string | null
  outlierIndex: number | null
  baselineN: number
}

/** 떡상 1건 + 같은 조건의 평범 N건. AI가 읽을 한 단위. */
export interface ContrastSet {
  winner: DiscoverySample
  peers: DiscoverySample[]
}

function daysApart(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const ta = new Date(a).getTime()
  const tb = new Date(b).getTime()
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null
  return Math.abs(ta - tb) / 86_400_000
}

function isWinner(s: DiscoverySample): boolean {
  return s.outlierIndex != null && s.outlierIndex >= WINNER_MIN_INDEX
}

function isPeer(s: DiscoverySample): boolean {
  return s.outlierIndex != null
    && s.outlierIndex >= PEER_MIN_INDEX
    && s.outlierIndex <= PEER_MAX_INDEX
}

/**
 * 대조쌍을 만든다.
 *
 * 대조군을 못 채운 떡상은 **버린다**. 대조 없이 AI에게 떡상만 보여주면
 * AI는 그 콘텐츠를 묘사할 뿐 "왜 이것만 잘됐는지"를 못 말한다 —
 * 그게 지금 시스템이 실패한 방식(단정)과 같아진다.
 */
export function buildContrastSets(samples: readonly DiscoverySample[]): ContrastSet[] {
  const sets: ContrastSet[] = []

  // 채널 안에서만 대조한다. 채널이 다르면 규모가 이유로 섞여 들어온다.
  const byChannel = new Map<string, DiscoverySample[]>()
  for (const s of samples) {
    if (!s.channelId) continue
    const list = byChannel.get(s.channelId) ?? []
    list.push(s)
    byChannel.set(s.channelId, list)
  }

  // Map 반복자 직접 순회는 이 tsconfig 타깃에서 막힌다(cohort.ts 와 같은 이유)
  for (const list of Array.from(byChannel.values())) {
    const winners = list.filter(isWinner)
    const peers = list.filter(isPeer)

    for (const winner of winners) {
      const candidates = peers
        .filter((p) => p.contentId !== winner.contentId)
        // 포맷이 다르면 비교가 안 된다 — 숏폼과 롱폼은 다른 게임이다
        .filter((p) => p.format === winner.format)
        .map((p) => ({ p, gap: daysApart(p.publishedAt, winner.publishedAt) }))
        .filter((x) => x.gap != null && x.gap <= PEER_MAX_DAYS_APART)
        .sort((a, b) => (a.gap as number) - (b.gap as number))
        .slice(0, PEERS_PER_WINNER)
        .map((x) => x.p)

      // 대조군이 모자라면 이 떡상은 설명하지 않는다. 근거 없이 말하지 않는다.
      if (candidates.length < PEERS_PER_WINNER) continue

      sets.push({ winner, peers: candidates })
    }
  }

  // 배수가 큰 것부터 — AI 예산이 한정될 때 설명 가치가 큰 것을 먼저 쓴다
  return sets.sort((a, b) => (b.winner.outlierIndex ?? 0) - (a.winner.outlierIndex ?? 0))
}

/** AI가 대조쌍 1개를 읽고 낸 결과 */
export interface RawFinding {
  contentId: string
  channelId: string | null
  /** "이 1건만 가진 것"을 한 문장으로 */
  statement: string
  /** 무엇을 근거로 그렇게 봤는지 (원문 인용·관찰) */
  observation: string
}

/**
 * AI 2차 패스가 묶은 군집. 같은 뜻의 문장들이 하나로 모인다.
 *
 * 군집을 코드가 아니라 AI에게 맡기는 이유: 한국어 자유 문장의 동의 판정은
 * 문자열 정규화로 안 된다. "실패담으로 시작한다"와 "처음에 망한 얘기를 꺼낸다"는
 * 같은 뜻인데 글자가 하나도 안 겹친다.
 */
export interface FindingCluster {
  /** 군집을 대표하는 문장 */
  statement: string
  /** 이 군집에 속한 RawFinding의 contentId */
  contentIds: string[]
}

export type DiscoveryKind = 'hook' | 'subject' | 'format' | 'timing' | 'presentation' | 'other'

export interface PromotedDiscovery {
  statement: string
  kind: DiscoveryKind
  contentIds: string[]
  channelIds: string[]
  evidenceCount: number
  channelCount: number
}

export interface PromotionResult {
  promoted: PromotedDiscovery[]
  /** 승격 못 한 군집과 이유 — 조용히 버리지 않는다 */
  rejected: { statement: string; reason: string; evidenceCount: number; channelCount: number }[]
}

/**
 * 군집을 공식으로 승격할지 판정한다.
 *
 * 옛 시스템은 근거 104건이면 통과시켰다. 그런데 그 104건이 전부 같은 6채널에서
 * 나왔고, 효과는 1.26배였다. 수가 많다고 공식이 되는 게 아니다 —
 * **서로 다른 채널에서 반복돼야** 재현 가능한 것이다.
 */
export function promoteDiscoveries(
  clusters: readonly FindingCluster[],
  findings: readonly RawFinding[],
  kinds?: Readonly<Record<string, DiscoveryKind>>,
): PromotionResult {
  const channelOf = new Map<string, string | null>()
  for (const f of findings) channelOf.set(f.contentId, f.channelId)

  const promoted: PromotedDiscovery[] = []
  const rejected: PromotionResult['rejected'] = []

  for (const c of clusters) {
    const contentIds = Array.from(new Set(c.contentIds))
    const channelIds = Array.from(
      new Set(contentIds.map((id) => channelOf.get(id)).filter((v): v is string => Boolean(v))),
    )
    const evidenceCount = contentIds.length
    const channelCount = channelIds.length

    if (channelCount < DISCOVERY_MIN_CHANNELS) {
      rejected.push({
        statement: c.statement,
        reason: `${channelCount}개 채널에서만 나타남 — ${DISCOVERY_MIN_CHANNELS}곳 이상이어야 시장의 경향입니다`,
        evidenceCount, channelCount,
      })
      continue
    }
    if (evidenceCount < DISCOVERY_MIN_EVIDENCE) {
      rejected.push({
        statement: c.statement,
        reason: `근거 ${evidenceCount}건 — ${DISCOVERY_MIN_EVIDENCE}건 이상이어야 합니다`,
        evidenceCount, channelCount,
      })
      continue
    }

    promoted.push({
      statement: c.statement,
      kind: kinds?.[c.statement] ?? 'other',
      contentIds, channelIds, evidenceCount, channelCount,
    })
  }

  // 채널 수 우선, 같으면 근거 수 — 널리 반복된 것이 위로
  promoted.sort((a, b) => b.channelCount - a.channelCount || b.evidenceCount - a.evidenceCount)
  return { promoted, rejected }
}

/**
 * 발견 문장의 근거를 사람 말로.
 *
 * 설계서 §4.3이 요구하는 "근거 개수와 채널 수 병기"를 이 한 곳에서만 만든다.
 * 화면이 직접 조립하면 화면마다 표기가 갈린다.
 */
export function formatDiscoveryBasis(evidenceCount: number, channelCount: number): string {
  return `근거 ${evidenceCount}건 · 채널 ${channelCount}곳`
}
