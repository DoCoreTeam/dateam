// lib/ci/queries/trends.ts — 트렌드 시장·공식·이슈 탭 데이터 (서버 전용)

import { createAdminClient } from '@/lib/supabase/server'
import { CORPUS_FILTER } from '../corpus.ts'
import { formatBasis, formatLift, formatOutlier } from '../format/metrics.ts'
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
