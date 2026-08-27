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

/**
 * AI 호출 간 최소 간격(ms).
 *
 * 왜 있나: 간격 없이 60건을 쏘자 429가 나고 재시도까지 겹쳐
 * **123회 호출에 성공 0회**였다(실측 2026-08-27). 몰아치면 빨리 가려다 아예 못 간다.
 *
 * ⚠️ 무료 티어의 진짜 벽은 분당이 아니라 **하루**다. 실측 quotaId:
 *   `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, value **20** (모델당 하루 20회)
 * 즉 이 간격만으로는 무료 티어에서 이 기능이 돌지 않는다 — 유료 키가 있어야 한다.
 * 간격은 그때(분당 한도가 실제 벽이 되는 유료 구간)를 위한 것이고,
 * 무료 구간에서는 **남은 하루치를 재시도로 태우지 않게** 하는 역할을 한다.
 */
export const MIN_CALL_INTERVAL_MS = 3_200

/** 무료 티어 실측 일일 한도(모델당). 화면·로그가 사용자에게 숫자로 말할 때 쓴다. */
export const FREE_TIER_DAILY_LIMIT = 20

/**
 * 한 주제에서 한 번에 설명할 떡상 수.
 *
 * 실측(2026-08-27)으로 정한 값이다. **채널당 표본 수가 결과를 가른다.**
 *   12건(채널당 4) → 군집이 전부 1채널 → 승격 0건
 *   30건(채널당 10) → 군집 3개가 채널 3곳 → 승격 3건
 * 같은 채널의 발견끼리 먼저 뭉치기 때문에, 채널을 가로지르는 반복이 잡히려면
 * 채널마다 충분히 여러 건을 봐야 한다. 적게 부르면 돈은 아끼지만 **결과가 0이다.**
 *
 * 위로는 시간이 제약이다 — 30건 × 3.2초 ≈ 100초/주제.
 */
export const DEFAULT_MAX_SETS = 30

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
  sets.sort((a, b) => (b.winner.outlierIndex ?? 0) - (a.winner.outlierIndex ?? 0))

  // 그런데 배수만으로 자르면 **한 채널이 표본을 독점한다.**
  // 실측(2026-08-27): 장사의 신이 떡상 354건이라 상위 12개가 전부 그 채널이었고,
  // 그 결과 발견 11건이 모두 "1개 채널에서만 나타남"으로 탈락했다(승격 0).
  // 승격 조건이 "서로 다른 채널 3곳"인데 표본이 한 채널이면 **구조적으로 아무것도 못 올린다.**
  // 그래서 채널을 돌아가며 뽑는다 — 각 채널의 1등, 2등, … 순서.
  return roundRobinByChannel(sets)
}

/**
 * 채널을 돌아가며 하나씩 뽑아 재배열한다.
 *
 * 채널 안의 순서(배수 내림차순)는 유지하면서, 앞쪽에 여러 채널이 고루 들어오게 한다.
 * 호출부가 앞에서 N개를 잘라도 표본이 한 채널로 쏠리지 않는다.
 */
export function roundRobinByChannel(sets: readonly ContrastSet[]): ContrastSet[] {
  const byChannel = new Map<string, ContrastSet[]>()
  for (const s of sets) {
    const k = s.winner.channelId ?? '(unknown)'
    const list = byChannel.get(k) ?? []
    list.push(s)
    byChannel.set(k, list)
  }

  // 채널 순서는 "가장 높은 배수를 가진 채널"부터 — 설명 가치가 큰 쪽을 앞에 둔다
  const queues = Array.from(byChannel.values())
    .sort((a, b) => (b[0]?.winner.outlierIndex ?? 0) - (a[0]?.winner.outlierIndex ?? 0))

  const out: ContrastSet[] = []
  for (let i = 0; out.length < sets.length; i += 1) {
    let moved = false
    for (const q of queues) {
      if (i < q.length) { out.push(q[i]); moved = true }
    }
    if (!moved) break
  }
  return out
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

/**
 * 묶기 폴백 — AI 2차 패스가 실패했을 때 쓰는 결정론 군집.
 *
 * 왜 필요한가(실측 2026-08-27): 묶기는 **마지막 호출**이라 그때쯤 할당량이 바닥난다.
 * 실패하면 각 문장이 홀로 남고, 홀로 남으면 채널이 1곳이라
 * 승격 조건("서로 다른 채널 3곳")에 **구조적으로 전부 탈락**한다 — 결과가 언제나 0건이다.
 * 발견 12건을 만들어 놓고 0건을 보여주는 것은 만들지 않은 것과 같다.
 *
 * 그래서 글자가 겹치는 정도로라도 묶는다. AI 묶기보다 거칠지만,
 * **승격 문턱(채널 3곳)이 그대로 남아 있어** 잘못 묶여도 아무거나 올라가지 않는다.
 */
const STOPWORDS = new Set([
  '하는', '한다', '하여', '해서', '있는', '있다', '것을', '것이', '통해', '위해',
  '사용', '활용', '제목', '콘텐츠', '영상', '시청자', '유발', '유도',
])

/** 한국어 문장에서 의미 토큰만 성기게 뽑는다. 형태소 분석기 없이 어절 앞부분을 쓴다. */
export function statementTokens(text: string): Set<string> {
  const words = text
    // \p{L} 같은 유니코드 속성은 이 tsconfig 타깃에서 못 쓴다 — 한글·영숫자 범위로 직접 적는다
    .replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const out = new Set<string>()
  for (const w of words) {
    // 조사·어미가 붙은 어절이라 앞 2~4글자만 쓴다 ("유명인의" -> "유명인")
    const stem = w.length > 4 ? w.slice(0, 4) : w
    if (stem.length < 2) continue
    if (STOPWORDS.has(stem) || STOPWORDS.has(w)) continue
    out.add(stem)
  }
  return out
}

/**
 * 두 문장이 같은 뜻인지 성기게 판정. 겹치는 의미 토큰이 이 수 이상이면 같은 묶음으로 본다.
 *
 * 실측(2026-08-27, 실제 발견 30건·채널 3곳으로 비교):
 *   2 → 군집 10, 승격 2건 (더 많이 잡지만 서로 다른 뜻이 섞일 여지가 크다)
 *   3 → 군집 17, 승격 1건 (묶인 것은 확실히 같은 뜻이다)
 *   4 → 군집 24, 승격 0건 (아무것도 안 묶인다)
 * 3을 고른다 — 틀리게 묶느니 덜 올린다. 승격은 "시장의 경향"이라고 말하는 일이라
 * 한 번 틀리면 그 뒤 모든 문장을 사용자가 안 믿는다.
 */
export const OVERLAP_MIN_SHARED_TOKENS = 3

/**
 * 대표 문장에서 피해야 할 말.
 *
 * 실측: 군집 21건짜리 대표가 "시청자의 호기심을 유발하는 **다양한 형태의 제목 전략**을
 * 사용한다"로 뽑혔다. 근거는 충분한데 **따라 만들 수가 없는 문장**이다.
 * 원인은 문턱이 아니라 대표를 "가장 긴 것"으로 고른 규칙이었다 —
 * 뭉뚱그린 문장이 대개 더 길기 때문이다.
 */
const VAGUE_TOKENS = new Set([
  '다양한', '여러', '등을', '등의', '전략', '요소', '형태', '방식', '내용을', '활용',
])

/**
 * 군집을 대표할 문장을 고른다 — **가장 구체적인 것**.
 *
 * 뭉뚱그린 말이 들어 있으면 점수를 깎는다. 길이로 고르면 뭉뚱그린 문장이 이긴다(실측).
 */
export function pickRepresentative(statements: readonly string[]): string {
  let best = statements[0] ?? ''
  let bestScore = -Infinity
  for (const st of statements) {
    const toks = Array.from(statementTokens(st))
    const vague = toks.filter((t) => VAGUE_TOKENS.has(t)).length
    // 구체 토큰은 +1, 뭉뚱그린 토큰은 -3 — 하나만 섞여도 밀리게 한다
    const score = (toks.length - vague) - vague * 3
    if (score > bestScore) { bestScore = score; best = st }
  }
  return best
}

export function clusterByOverlap(findings: readonly RawFinding[]): FindingCluster[] {
  const groups: { tokens: Set<string>; statements: string[]; contentIds: string[] }[] = []

  for (const f of findings) {
    const t = statementTokens(f.statement)
    let joined = false
    for (const g of groups) {
      let shared = 0
      for (const tok of Array.from(t)) if (g.tokens.has(tok)) shared += 1
      if (shared >= OVERLAP_MIN_SHARED_TOKENS) {
        g.contentIds.push(f.contentId)
        g.statements.push(f.statement)
        for (const tok of Array.from(t)) g.tokens.add(tok)
        joined = true
        break
      }
    }
    if (!joined) groups.push({ tokens: t, statements: [f.statement], contentIds: [f.contentId] })
  }

  return groups.map((g) => ({
    statement: pickRepresentative(g.statements),
    contentIds: g.contentIds,
  }))
}

/**
 * AI가 묶은 결과를 한 번 더 합친다.
 *
 * 왜 필요한가(실측 2026-08-27): AI 묶기는 **일관되지 않다.** 같은 12개 문장을 두고
 * 한 번은 4건짜리 군집을 만들었고, 다음 실행에서는 11개를 거의 전부 홀로 두었다.
 * 홀로 남으면 채널이 1곳이라 승격 문턱(3곳)에 전부 탈락한다 — 결과가 0건이 된다.
 *
 * 파이프라인이 **AI의 그날 기분에 좌우되면 안 된다.** 그래서 AI 묶기 뒤에
 * 글자 겹침으로 한 번 더 합친다. AI가 이미 잘 묶었으면 이 단계는 아무것도 안 바꾼다.
 * 승격 문턱은 그대로라, 합쳐도 아무거나 올라가지 않는다.
 */
export function mergeClusters(clusters: readonly FindingCluster[]): FindingCluster[] {
  const groups: { tokens: Set<string>; statements: string[]; contentIds: string[] }[] = []

  for (const c of clusters) {
    const t = statementTokens(c.statement)
    let joined = false
    for (const g of groups) {
      let shared = 0
      for (const tok of Array.from(t)) if (g.tokens.has(tok)) shared += 1
      if (shared >= OVERLAP_MIN_SHARED_TOKENS) {
        g.contentIds.push(...c.contentIds)
        g.statements.push(c.statement)
        for (const tok of Array.from(t)) g.tokens.add(tok)
        joined = true
        break
      }
    }
    if (!joined) {
      groups.push({ tokens: t, statements: [c.statement], contentIds: [...c.contentIds] })
    }
  }

  return groups.map((g) => ({
    statement: pickRepresentative(g.statements),
    contentIds: Array.from(new Set(g.contentIds)),
  }))
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
