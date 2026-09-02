// lib/ci/queries/trends.ts — 트렌드 시장·공식·이슈 탭 데이터 (서버 전용)

import { createAdminClient } from '@/lib/supabase/server'
import { CORPUS_FILTER } from '../corpus.ts'
import { formatBasis, formatOutlier, SEASON_MIN_WINDOW_DAYS } from '../format/metrics.ts'
import { median } from '../analysis/outlier.ts'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { CI_PLATFORM_LABEL, type CiConfidence, type CiPlatform } from '../types.ts'
import { formatDiscoveryBasis } from '../analysis/discovery.ts'
import type { SignalSweepState } from '../analysis/signals.ts'
import { loadWorkspaceSetting } from '../settings/load.ts'
import { isQuotaMessage, isUnsupportedStageMessage } from '../analysis/signals.ts'
import {
  effectiveSignalIntervalHours, normalizeSignalIntervalHours, nextSignalSweepAt,
} from '../jobs/signals-sweep-policy.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MarketSlice {
  label: string
  count: number
  medianOutlierText: string | null
  share: number
}

export interface MarketOverview {
  population: number
  windowDays: number
  basisText: string
  insufficient: boolean
  byPlatform: MarketSlice[]
  byFormat: MarketSlice[]
  topChannels: { id: string; name: string; count: number; medianOutlierText: string | null }[]
}

const FORMAT_LABEL: Record<string, string> = {
  short: '숏폼', long: '롱폼', image: '이미지', text: '텍스트', live: '라이브',
}

function slice(
  rows: { key: string; label: string; outlier: number | null; baselineN: number }[],
  total: number,
): MarketSlice[] {
  const groups = new Map<string, { label: string; values: number[]; count: number }>()
  for (const r of rows) {
    const g = groups.get(r.key) ?? { label: r.label, values: [], count: 0 }
    g.count++
    if (r.outlier != null && r.baselineN >= 8) g.values.push(r.outlier)
    groups.set(r.key, g)
  }
  return Array.from(groups.values())
    .map((g) => {
      const m = median(g.values)
      return {
        label: g.label,
        count: g.count,
        medianOutlierText: m != null ? formatOutlier(m, 8) : null,
        share: total > 0 ? Math.round((g.count / total) * 100) : 0,
      }
    })
    .sort((a, b) => b.count - a.count)
}

export async function getMarketOverview(
  workspaceId: string,
  windowDays = 28,
  topicId?: string | null,
): Promise<MarketOverview> {
  const adminClient = createAdminClient() as any
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString()

  let q = adminClient
    .from('ci_contents')
    .select('id, platform, format, channel_id, ci_channels ( id, display_name ), ci_content_derived ( outlier_index, outlier_baseline_n )', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .eq('source', CORPUS_FILTER.source)
    .eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
    .is('deleted_at', null)
    .or(`published_at.gte.${since},and(published_at.is.null,first_seen_at.gte.${since})`)
    .limit(1000)

  if (topicId) q = q.eq('topic_id', topicId)

  const { data, count } = await q
  const rows = (data ?? []) as any[]
  const population = count ?? rows.length

  const platformRows = rows.map((r) => ({
    key: r.platform as string,
    label: CI_PLATFORM_LABEL[r.platform as CiPlatform],
    outlier: r.ci_content_derived?.outlier_index ?? null,
    baselineN: r.ci_content_derived?.outlier_baseline_n ?? 0,
  }))
  const formatRows = rows.map((r) => ({
    key: r.format as string,
    label: FORMAT_LABEL[r.format as string] ?? r.format,
    outlier: r.ci_content_derived?.outlier_index ?? null,
    baselineN: r.ci_content_derived?.outlier_baseline_n ?? 0,
  }))

  // 채널별 집계
  interface ChannelAgg { name: string; values: number[]; count: number }
  const chMap = new Map<string, ChannelAgg>()
  for (const r of rows) {
    if (!r.ci_channels?.id) continue
    const g: ChannelAgg = chMap.get(r.ci_channels.id)
      ?? { name: String(r.ci_channels.display_name ?? '이름 미확인'), values: [], count: 0 }
    g.count++
    if (r.ci_content_derived?.outlier_index != null && (r.ci_content_derived?.outlier_baseline_n ?? 0) >= 8) {
      g.values.push(Number(r.ci_content_derived.outlier_index))
    }
    chMap.set(r.ci_channels.id, g)
  }

  return {
    population,
    windowDays,
    basisText: formatBasis(windowDays, population),
    insufficient: population === 0,
    byPlatform: slice(platformRows, population),
    byFormat: slice(formatRows, population),
    topChannels: Array.from(chMap.entries())
      .map(([id, g]) => {
        const m = median(g.values)
        return { id, name: g.name, count: g.count, medianOutlierText: m != null ? formatOutlier(m, 8) : null }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  }
}

export interface PatternRow {
  id: string
  statement: string
  liftText: string | null
  kind: string
  confidence: CiConfidence
  topicName: string | null
}

/**
 * "성공 공식" 목록 — **ci_discoveries(발견)** 를 읽는다.
 *
 * 왜 소스가 바뀌었나(2026-08-27): 예전에는 ci_patterns 를 읽었다. 그 표는
 * patterns.ts 에 하드코딩된 규칙 7개를 데이터에 대조한 결과라, 617행이 전부
 * 같은 7문장의 중복이었고 효과는 1.21~1.25배 — 근거 104건으로 "쓸모없음"이 증명된 상태였다.
 * 게다가 617행 전부 is_archived=true 라 이 화면은 **구조적으로 늘 0건**이었다.
 *
 * 지금은 대조가 이유를 만든다(discovery.ts). 표만 바꾸면 화면·타입은 그대로 쓴다 —
 * 읽는 곳을 옮기는 것이 폐기의 첫 단계다(ci_patterns 자체는 아직 지우지 않는다, M-4).
 */
export async function getPatterns(workspaceId: string, topicId?: string | null): Promise<PatternRow[]> {
  const adminClient = createAdminClient() as any
  let q = adminClient.from('ci_discoveries')
    .select('id, statement, kind, evidence_count, channel_count, ci_topics ( name )')
    .eq('workspace_id', workspaceId).eq('is_archived', false)
    // 넓게 반복된 것이 먼저다 — 채널 수가 "우연이 아니다"의 근거이기 때문이다.
    .order('channel_count', { ascending: false })
    .order('evidence_count', { ascending: false })
    .limit(50)
  if (topicId) q = q.eq('topic_id', topicId)

  const { data } = await q
  return ((data ?? []) as any[]).map((d) => ({
    id: d.id,
    statement: d.statement,
    kind: d.kind,
    // 발견에는 배수(lift)가 없다. 있지도 않은 숫자를 만들지 않고 **근거의 넓이**를 그대로 쓴다.
    liftText: formatDiscoveryBasis(d.evidence_count, d.channel_count),
    // 확신도는 채널 수로 본다 — 한 채널의 습관과 시장의 반복을 가르는 축이 그것이다.
    confidence: (d.channel_count >= 5 ? 'high' : 'medium') as CiConfidence,
    topicName: d.ci_topics?.name ?? null,
  }))
}

export interface SignalRow {
  id: string
  kind: string
  title: string
  url: string | null
  source: string | null
  occurredAtText: string | null
  score: number | null
  topicName: string | null
  /**
   * AI 가 찾아온 후보에만 붙는다 — 왜 이걸 골랐는지.
   * 근거 없는 줄을 사람에게 확인시키면 확인이 아니라 받아쓰기가 된다.
   */
  reason?: string | null
  /** 후보의 확신도(0~1). 사람이 손으로 넣은 확정본에는 없다 */
  confidence?: number | null
  /** 언제 찾아왔나 */
  collectedAtText?: string | null
}

// 종류 이름의 SSOT 는 순수 모듈에 있다(analysis/signals).
// 여기 두면 클라이언트가 이 서버 전용 파일에서 값을 가져오게 되고, 그 순간 빌드가 깨진다.
// 서버 쪽 호출부가 두 곳을 import 하지 않도록 그대로 다시 내보낸다.
export { signalKindLabel } from '../analysis/signals.ts'

const SIGNAL_SELECT =
  'id, kind, title, url, source, occurred_at, score, status, confidence, evidence, '
  + 'collected_at, ci_topics ( name )'

/* eslint-disable @typescript-eslint/no-explicit-any */
function toSignalRow(s: any): SignalRow {
  return {
    id: s.id,
    kind: s.kind,
    title: s.title,
    url: s.url,
    source: s.source,
    occurredAtText: s.occurred_at ? formatKstDateTimeShort(s.occurred_at) : null,
    score: s.score,
    topicName: s.ci_topics?.name ?? null,
    reason: typeof s.evidence?.reason === 'string' ? s.evidence.reason : null,
    confidence: s.confidence != null ? Number(s.confidence) : null,
    collectedAtText: s.collected_at ? formatKstDateTimeShort(s.collected_at) : null,
  }
}

/**
 * 확정된 이슈만. **후보는 섞지 않는다.**
 *
 * 섞으면 아직 사람이 확인하지 않은 줄이 화면에서 사실처럼 읽히고,
 * 그게 기획의 근거가 된다. 후보는 `getSignalCandidates` 로 따로 본다.
 */
export async function getSignals(workspaceId: string, topicId?: string | null): Promise<SignalRow[]> {
  const adminClient = createAdminClient() as any
  let q = adminClient.from('ci_signals')
    .select(SIGNAL_SELECT)
    .eq('workspace_id', workspaceId)
    .eq('status', 'confirmed')
    .order('occurred_at', { ascending: false, nullsFirst: false })
    .limit(100)
  if (topicId) q = q.eq('topic_id', topicId)

  const { data } = await q
  return ((data ?? []) as any[]).map(toSignalRow)
}

/**
 * AI 가 찾아온 확인 대기 후보.
 *
 * 등록·폐기는 사람이 한다(CLAUDE.md §5-3 추출/제안형). 자동 등록하지 않는 이유는
 * 근거 없는 줄이 쌓이면 사람이 목록 전체를 안 보게 되고, 그 순간 이 기능은
 * 이슈 1건이던 시절과 정확히 같아지기 때문이다.
 */
export async function getSignalCandidates(
  workspaceId: string,
  topicId?: string | null,
): Promise<SignalRow[]> {
  const adminClient = createAdminClient() as any
  let q = adminClient.from('ci_signals')
    .select(SIGNAL_SELECT)
    .eq('workspace_id', workspaceId)
    .eq('status', 'candidate')
    // 찾아온 순서가 아니라 **최근에 일어난 것**부터 본다
    .order('occurred_at', { ascending: false, nullsFirst: false })
    .order('collected_at', { ascending: false, nullsFirst: false })
    .limit(30)
  if (topicId) q = q.eq('topic_id', topicId)

  const { data } = await q
  return ((data ?? []) as any[]).map(toSignalRow)
}

/**
 * 이슈 수집이 지금 어떤 상태인지.
 *
 * **후보가 0건인 것만으로는 아무것도 알 수 없다** — 아직 안 돌았는지, 돌았는데 없었는지,
 * 돌다가 실패했는지가 전부 「빈 화면」으로 똑같이 보인다. 실제로 사흘 동안 그랬다.
 * 그래서 마지막 훑은 시각과 마지막 잡의 결말을 함께 읽어 화면에 넘긴다.
 */
export async function getSignalSweepState(workspaceId: string): Promise<SignalSweepState> {
  const adminClient = createAdminClient() as any

  const [wsRes, jobRes, pendingRes, enabled] = await Promise.all([
    adminClient.from('ci_workspaces').select('last_signal_sweep_at, last_signal_success_at').eq('id', workspaceId).maybeSingle(),
    adminClient.from('ci_jobs')
      .select('status, error_message, updated_at')
      .eq('workspace_id', workspaceId).eq('stage', 'signals')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    adminClient.from('ci_signals')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('status', 'candidate'),
    // 설정 해석은 scope 가 겹쳐 쌓이므로 반드시 공용 로더를 거친다(SSOT)
    loadWorkspaceSetting<boolean>(workspaceId, 'signals.enabled'),
  ])

  const lastSweepAt: string | null = wsRes?.data?.last_signal_sweep_at ?? null
  // **성공한 때**는 별도 칸이다. 시도 시각으로 성공을 판정하면 실패한 뒤에도 「새 이슈 없음」이 된다
  const lastSuccessAt: string | null = wsRes?.data?.last_signal_success_at ?? null

  // 「며칠째」를 말하려면 **연속 실패의 시작점**이 필요하다. 마지막 성공 이후 첫 실패가 그 점이다.
  const { data: lastOkRow } = await adminClient.from('ci_jobs')
    .select('updated_at').eq('workspace_id', workspaceId).eq('stage', 'signals')
    .eq('status', 'succeeded').order('updated_at', { ascending: false }).limit(1).maybeSingle()
  let failingSinceQuery = adminClient.from('ci_jobs')
    .select('created_at').eq('workspace_id', workspaceId).eq('stage', 'signals')
    .in('status', ['failed', 'dead']).order('created_at', { ascending: true }).limit(1)
  // 자동(잡)·수동 어느 쪽이든 마지막 성공 이후만 «연속 실패»다
  const okBoundary = [lastOkRow?.updated_at, lastSuccessAt].filter(Boolean).sort().pop()
  if (okBoundary) failingSinceQuery = failingSinceQuery.gt('created_at', okBoundary)
  const { data: failingRow } = await failingSinceQuery.maybeSingle()
  const failingSince: string | null = failingRow?.created_at ?? null

  // 배포본이 남긴 «모르는 단계» 기록을 건너뛰고 **실제로 시도한** 마지막 기록을 찾는다
  const { data: realRows } = await adminClient.from('ci_jobs')
    .select('status, error_message, updated_at')
    .eq('workspace_id', workspaceId).eq('stage', 'signals')
    .order('created_at', { ascending: false }).limit(5)
  const lastRealJob = ((realRows ?? []) as { status?: string; error_message?: string | null; updated_at?: string }[])
    .find((r) => !isUnsupportedStageMessage(r.error_message)) ?? null
  const pending: number = pendingRes?.count ?? 0
  let job = jobRes?.data as { status?: string; error_message?: string | null; updated_at?: string } | null

  // 「그 워커가 이 단계를 몰랐다」는 실패가 아니다. 실패로 세면 ① 내부 문구가 화면에 뜨고
  // ② 진짜 원인(한도)이 가려져 짧은 재시도가 꺼진다. 그런 기록은 없는 것으로 본다.
  if (job && isUnsupportedStageMessage(job.error_message)) job = lastRealJob

  // 잡보다 **나중에 성공한** 기록이 있으면 그 잡은 지나간 일이다.
  // 「지금 수집」으로 성공한 뒤에도 죽은 잡 때문에 영영 「실패」로 보이던 것을 막는다.
  // 기준은 반드시 **성공 시각** — 시도 시각을 쓰면 실패한 시도가 성공으로 읽힌다.
  if (job?.updated_at && lastSuccessAt && lastSuccessAt > job.updated_at) job = null

  // 꺼져 있으면 나머지는 볼 필요가 없다 — 안 도는 것이 정상이라고 말해야 한다
  if (enabled === false) {
    return {
      outcome: 'off', lastSweepAt, reason: null, pending,
      nextAttemptAt: null, blockedByQuota: false, failingSince: null,
    }
  }

  let outcome: SignalSweepState['outcome']
  // 기록이 없으면 «성공했다»고 말하지 않는다 — 모르는 것을 좋은 쪽으로 지어내지 않는다
  if (!job) outcome = lastSuccessAt ? 'ok' : 'never'
  else if (job.status === 'running' || job.status === 'pending') {
    outcome = job.error_message ? 'retrying' : 'running'
  } else if (job.status === 'failed') outcome = 'retrying'
  else if (job.status === 'dead') outcome = 'failed'
  else outcome = 'ok'

  const reason = outcome === 'failed' || outcome === 'retrying' ? (job?.error_message ?? null) : null
  const blockedByQuota = isQuotaMessage(reason)

  // 한도면 짧은 주기로 다시 해본다 — 실행 정책과 **같은 계산**을 써야 화면이 거짓말하지 않는다
  const intervalHours = effectiveSignalIntervalHours(
    normalizeSignalIntervalHours(await loadWorkspaceSetting<number>(workspaceId, 'signals.interval_hours')),
    blockedByQuota,
  )

  return {
    outcome,
    lastSweepAt,
    // 실패 이유는 **잡이 남긴 말 그대로** 쓴다. 다시 쓰면 원인과 화면이 갈라진다
    reason,
    pending,
    // 여기까지 왔으면 꺼진 경우는 위에서 이미 반환됐다 — 항상 다음 시도가 있다
    nextAttemptAt: nextSignalSweepAt(lastSweepAt, intervalHours),
    blockedByQuota,
    failingSince,
  }
}

// ── 언제 통했나 (게시 맥락별 집계) ────────────────────────────
// "평소 대비 9배"만으로는 언제의 트렌드인지 알 수 없다.
// 계절·요일·시간대로 갈라 보면 "여름 주말 밤에 통했다"까지 말할 수 있다.

export interface TimingSlice {
  key: string
  label: string
  count: number
  /** 이 구간 배수 중앙값. 표본이 얇으면 null */
  medianOutlierText: string | null
}

export interface TimingOverview {
  bySeason: TimingSlice[]
  byDayPart: TimingSlice[]
  byWeekday: TimingSlice[]
  /** 맥락을 채운 콘텐츠 수 / 전체 */
  contextFilled: number
  total: number
  /** 지역을 몰라 UTC로 읽은 건수 — 화면이 한계를 밝힐 수 있게 */
  regionUnknown: number
  /** 어느 기간을 읽었는가 — 화면 위쪽 조건과 같은 값이어야 한다 */
  windowDays: number
  /** 계절을 말할 수 있는 기간인가. 28일 창에서 "가을 1.9배"는 계절 얘기가 아니다. */
  seasonMeaningful: boolean
}


const SEASON_KO: Record<string, string> = {
  spring: '봄', summer: '여름', autumn: '가을', winter: '겨울',
}
const DAYPART_KO: Record<string, string> = {
  dawn: '새벽', morning: '오전', afternoon: '오후', evening: '저녁', night: '밤',
}
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토']

/** 표본이 이 수보다 적으면 중앙값을 말하지 않는다 — 한두 건으로 계절을 논하지 않는다. */
export const TIMING_MIN_SAMPLE = 3

function sliceOf(
  rows: { key: string | null; outlier: number | null }[],
  keys: string[],
  labelOf: (k: string) => string,
): TimingSlice[] {
  return keys.map((k) => {
    const mine = rows.filter((r) => r.key === k)
    const values = mine.map((r) => r.outlier).filter((v): v is number => v != null).sort((a, b) => a - b)
    const mid = Math.floor(values.length / 2)
    const median = values.length === 0 ? null
      : values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid]
    return {
      key: k,
      label: labelOf(k),
      count: mine.length,
      medianOutlierText: median != null && values.length >= TIMING_MIN_SAMPLE
        ? `평소 대비 ${median.toFixed(1)}배`
        : null,
    }
  }).filter((s) => s.count > 0)
}

/**
 * 게시 맥락별 집계.
 *
 * ⚠️ `windowDays`·`topicId`는 **선택이 아니라 의무**다.
 * 예전에는 이 함수가 조건을 아예 안 받아, 위쪽은 "28일 표본 18건"인데
 * 아래쪽은 "312/313건"을 보여줬다. 같은 화면에 모집단이 둘이었고,
 * 기간을 바꿔도 아래 절반은 꿈쩍하지 않았다. 조건 바가 화면 전체를 지배해야 한다.
 */
export async function getTimingOverview(
  workspaceId: string,
  windowDays = 28,
  topicId?: string | null,
): Promise<TimingOverview> {
  const adminClient = createAdminClient() as any
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString()

  let q = adminClient
    .from('ci_contents')
    .select('season, day_part, weekday, region_known, ci_content_derived ( outlier_index )')
    .eq('workspace_id', workspaceId)
    .eq('source', CORPUS_FILTER.source)
    .eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
    .is('deleted_at', null)
    // 집계표(getMarketOverview)와 **같은 기간 식**을 쓴다 — 다르면 모집단이 갈린다
    .or(`published_at.gte.${since},and(published_at.is.null,first_seen_at.gte.${since})`)
    .limit(1000)

  if (topicId) q = q.eq('topic_id', topicId)

  const { data } = await q

  const rows = (data ?? []) as {
    season: string | null; day_part: string | null; weekday: number | null
    region_known: boolean | null
    ci_content_derived: { outlier_index: number | null } | null
  }[]

  const withOutlier = rows.map((r) => ({ ...r, outlier: r.ci_content_derived?.outlier_index ?? null }))

  return {
    bySeason: sliceOf(
      withOutlier.map((r) => ({ key: r.season, outlier: r.outlier })),
      ['spring', 'summer', 'autumn', 'winter'], (k) => SEASON_KO[k] ?? k,
    ),
    byDayPart: sliceOf(
      withOutlier.map((r) => ({ key: r.day_part, outlier: r.outlier })),
      ['dawn', 'morning', 'afternoon', 'evening', 'night'], (k) => DAYPART_KO[k] ?? k,
    ),
    byWeekday: sliceOf(
      withOutlier.map((r) => ({ key: r.weekday == null ? null : String(r.weekday), outlier: r.outlier })),
      ['0', '1', '2', '3', '4', '5', '6'], (k) => `${WEEKDAY_KO[Number(k)]}요일`,
    ),
    contextFilled: rows.filter((r) => r.season != null).length,
    total: rows.length,
    regionUnknown: rows.filter((r) => r.season != null && r.region_known === false).length,
    windowDays,
    seasonMeaningful: windowDays >= SEASON_MIN_WINDOW_DAYS,
  }
}
