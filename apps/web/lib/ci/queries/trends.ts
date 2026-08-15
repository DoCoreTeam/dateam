// lib/ci/queries/trends.ts — 트렌드 시장·공식·이슈 탭 데이터 (서버 전용)

import { createAdminClient } from '@/lib/supabase/server'
import { CORPUS_FILTER } from '../corpus.ts'
import { formatBasis, formatLift, formatOutlier, SEASON_MIN_WINDOW_DAYS } from '../format/metrics.ts'
import { median } from '../analysis/outlier.ts'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { CI_PLATFORM_LABEL, type CiConfidence, type CiPlatform } from '../types.ts'

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

export async function getPatterns(workspaceId: string, topicId?: string | null): Promise<PatternRow[]> {
  const adminClient = createAdminClient() as any
  let q = adminClient.from('ci_patterns')
    .select('id, statement, kind, lift, evidence_count, channel_count, confidence, ci_topics ( name )')
    .eq('workspace_id', workspaceId).eq('is_archived', false)
    .order('lift', { ascending: false }).limit(50)
  if (topicId) q = q.eq('topic_id', topicId)

  const { data } = await q
  return ((data ?? []) as any[]).map((p) => ({
    id: p.id,
    statement: p.statement,
    kind: p.kind,
    liftText: formatLift(p.lift, p.evidence_count, p.channel_count),
    confidence: p.confidence as CiConfidence,
    topicName: p.ci_topics?.name ?? null,
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
}

const SIGNAL_KIND_LABEL: Record<string, string> = {
  news: '뉴스', search_spike: '검색 급상승', community: '커뮤니티 화제',
}

export function signalKindLabel(kind: string): string {
  return SIGNAL_KIND_LABEL[kind] ?? kind
}

export async function getSignals(workspaceId: string, topicId?: string | null): Promise<SignalRow[]> {
  const adminClient = createAdminClient() as any
  let q = adminClient.from('ci_signals')
    .select('id, kind, title, url, source, occurred_at, score, ci_topics ( name )')
    .eq('workspace_id', workspaceId)
    .order('occurred_at', { ascending: false, nullsFirst: false })
    .limit(100)
  if (topicId) q = q.eq('topic_id', topicId)

  const { data } = await q
  return ((data ?? []) as any[]).map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    url: s.url,
    source: s.source,
    occurredAtText: s.occurred_at ? formatKstDateTimeShort(s.occurred_at) : null,
    score: s.score,
    topicName: s.ci_topics?.name ?? null,
  }))
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
