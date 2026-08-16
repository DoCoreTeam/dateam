// lib/ci/analysis/derive.ts — 파생값 계산의 DB 어댑터 (서버 전용)
// 계산 규칙은 outlier.ts(순수)가, **무엇을 넣을지** 고르는 규칙은 derive-select.ts(순수)가 갖는다.
// 여기서는 데이터만 모아 넘긴다.
//
// v0.7.492 — 콘텐츠 1건씩 8왕복 → 여러 건을 한 번에 모아 계산하도록 바꿨다.
//   예전 구조: `computeDerived(1건)` = 왕복 8회(대상·조회수·형제·형제지표·동료·동료지표·스냅샷·저장)
//              `recomputeChannelDerived(채널)` = 그걸 **최대 500건에 순차** → 왕복 4,000회.
//              왕복 10ms만 잡아도 40초다. 실측으로도 잡 하나가 15초에 왕복 266회를 냈다.
//   지금 구조: 대상 전체를 한 번에 읽고, 형제·동료·지표를 **묶음 조회**한 뒤 메모리에서 갈라
//              한 번에 저장한다. 500건이 왕복 10여 회로 끝난다.
//
// ⚠️ 계산 결과는 바뀌지 않아야 한다. DB가 골라 주던 정렬·null 처리를 그대로 옮겼고
//    그 규칙은 derive-select.test.ts가 잠근다.

import { createAdminClient } from '@/lib/supabase/server'
import { CORPUS_FILTER } from '../corpus.ts'
import { computeAll, type VelocityPoint } from './outlier.ts'
import {
  pickBaselineIds, latestNonNullViews, newestViews, oldestSnapshots,
  groupMetricsDesc, topicComboKey, chunk,
  type ContentLite, type MetricRow,
} from './derive-select.ts'
import type { CiComparability } from '../types.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 배수 비교군 크기 — 같은 채널·같은 포맷 최근 N개 (설계서 §4.3) */
export { BASELINE_WINDOW } from './derive-select.ts'

/** 백분위 모집단 상한 — 너무 큰 창은 쿼리를 무겁게 만든다 */
const POPULATION_LIMIT = 500

/** 채널 재계산이 한 번에 다루는 콘텐츠 상한 (기존과 동일) */
const CHANNEL_RECOMPUTE_LIMIT = 500

/** 묶음 조회의 행 상한 — 안 걸어 두면 지표가 쌓일수록 한 번에 다 끌어온다 */
const METRIC_ROWS_LIMIT = 5000

const CONTENT_COLUMNS =
  'id, workspace_id, channel_id, platform, format, topic_id, completeness,'
  + ' comparability_class, published_at, source, is_stat_excluded, deleted_at'

interface ContentRow extends ContentLite {
  workspace_id: string
  platform: string | null
  topic_id: string | null
  completeness: number | null
  comparability_class: string | null
  source: string | null
  is_stat_excluded: boolean | null
  deleted_at: string | null
}

/** 코퍼스(통계 모집단) 조건 — 인메모리 판정. 조건 자체는 corpus.ts가 SSOT다. */
function inCorpus(c: ContentRow): boolean {
  return c.source === CORPUS_FILTER.source
    && c.is_stat_excluded === CORPUS_FILTER.is_stat_excluded
    && c.deleted_at === null
}

async function fetchMetrics(adminClient: any, ids: string[]): Promise<MetricRow[]> {
  const out: MetricRow[] = []
  for (const part of chunk(ids)) {
    const { data } = await adminClient
      .from('ci_content_metrics')
      .select('content_id, views, captured_at')
      .in('content_id', part)
      .limit(METRIC_ROWS_LIMIT)
    out.push(...((data ?? []) as MetricRow[]))
  }
  return out
}

/**
 * 여러 콘텐츠의 파생값을 **한 번에** 계산해 저장한다.
 * 실패해도 예외를 던지지 않는다 — 파생값이 없는 것은 화면이 '—'로 정직하게 표시한다.
 *
 * @returns 실제로 저장한 건수
 */
export async function computeDerivedForContents(contentIds: string[]): Promise<number> {
  const ids = Array.from(new Set(contentIds.filter(Boolean)))
  if (ids.length === 0) return 0

  const adminClient = createAdminClient() as any
  const windowDays = 28
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString()

  // 1) 대상 콘텐츠
  const targets: ContentRow[] = []
  for (const part of chunk(ids)) {
    const { data } = await adminClient.from('ci_contents').select(CONTENT_COLUMNS).in('id', part)
    targets.push(...((data ?? []) as ContentRow[]))
  }
  if (targets.length === 0) return 0

  // 2) 비교군 후보 — 대상들이 속한 채널의 **코퍼스 콘텐츠 전부**.
  //    예전엔 대상 1건마다 이 조회를 따로 했다(형제 20개). 채널 단위로 한 번만 읽으면
  //    같은 목록에서 각자의 20개를 메모리로 골라낼 수 있다.
  const channelIds = Array.from(new Set(targets.map((t) => t.channel_id).filter(Boolean) as string[]))
  const pool: ContentLite[] = []
  for (const part of chunk(channelIds)) {
    const { data } = await adminClient
      .from('ci_contents')
      .select('id, channel_id, format, published_at')
      .in('channel_id', part)
      .eq('source', CORPUS_FILTER.source)
      .eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
      .is('deleted_at', null)
      .limit(POPULATION_LIMIT * 4)
    pool.push(...((data ?? []) as ContentLite[]))
  }

  // 3) 주제 모집단 — (주제·플랫폼·포맷) 조합마다 **한 번씩만** 읽는다.
  //    같은 채널의 콘텐츠는 대개 조합이 1~3개라 500번이 3번이 된다.
  const comboIds = new Map<string, string[]>()
  const combos = new Map<string, ContentRow>()
  for (const t of targets) {
    if (!t.topic_id) continue
    const key = topicComboKey(t.topic_id, t.platform, t.format)
    if (!combos.has(key)) combos.set(key, t)
  }
  for (const [key, sample] of Array.from(combos.entries())) {
    const { data } = await adminClient
      .from('ci_contents')
      .select('id')
      .eq('workspace_id', sample.workspace_id)
      .eq('topic_id', sample.topic_id)
      .eq('platform', sample.platform)
      .eq('format', sample.format)
      .eq('source', CORPUS_FILTER.source)
      .eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
      .is('deleted_at', null)
      .gte('published_at', since)
      .limit(POPULATION_LIMIT)
    comboIds.set(key, ((data ?? []) as { id: string }[]).map((r) => r.id))
  }

  // 4) 지표 — 대상·비교군 후보·주제 모집단을 통틀어 한 번에 읽는다
  const needMetrics = new Set<string>(targets.map((t) => t.id))
  for (const p of pool) needMetrics.add(p.id)
  comboIds.forEach((list) => { for (const id of list) needMetrics.add(id) })
  const byContent = groupMetricsDesc(await fetchMetrics(adminClient, Array.from(needMetrics)))

  // 5) 계산
  const corpusPool = pool.filter((p) => p.channel_id != null)
  const computedAt = new Date().toISOString()
  const rows = targets.map((t) => {
    const baselineIds = pickBaselineIds(t, corpusPool)
    const baselineViews = latestNonNullViews(baselineIds, byContent)

    const topicPopulation = t.topic_id
      ? latestNonNullViews(comboIds.get(topicComboKey(t.topic_id, t.platform, t.format)) ?? [], byContent)
      : []

    const snapshots = oldestSnapshots(t.id, byContent)

    // ⚠️ 이름을 여기서 바꿔 넘긴다. 예전 코드는 DB 행(`captured_at`)을 그대로
    //    `VelocityPoint`(`capturedAt`)로 **캐스팅만** 해서 넘겼다 —
    //    `Date.parse(undefined)`가 NaN이 되어 모든 점이 걸러졌고,
    //    **조회 속도가 한 번도 계산된 적이 없다**(실측: 317건 전부 null,
    //    스냅샷 2개 이상인 콘텐츠는 19건 있었다). 떡상 탭의 '조회 속도순' 정렬이
    //    그동안 아무 일도 하지 않았다. 타입 캐스팅이 오류를 가려 준 자리다.
    const points: VelocityPoint[] = snapshots.map((s) => ({
      capturedAt: s.captured_at, views: s.views,
    }))

    const derived = computeAll({
      views: newestViews(t.id, byContent),
      baselineViews,
      topicPopulation,
      snapshots: points,
      completeness: Number(t.completeness ?? 0),
      comparability: (t.comparability_class ?? null) as CiComparability | null,
    })

    return {
      content_id: t.id,
      outlier_index: derived.outlierIndex,
      outlier_baseline_n: derived.outlierBaselineN,
      topic_percentile: derived.topicPercentile,
      velocity_per_hour: derived.velocityPerHour,
      confidence: derived.confidence,
      window_days: windowDays,
      sample_json: {
        baselineSize: baselineViews.length,
        population: topicPopulation.length,
        snapshots: snapshots.length,
        excluded: [
          { reason: '수집함 단건(통계 제외)', count: 0 },
        ],
      },
      computed_at: computedAt,
    }
  })

  // 6) 저장 — 건당 upsert가 아니라 묶음 한 번
  for (const part of chunk(rows, 200)) {
    await adminClient.from('ci_content_derived').upsert(part, { onConflict: 'content_id' })
  }
  return rows.length
}

/**
 * 한 콘텐츠의 파생값을 계산해 저장한다.
 * 계산에 실패해도 예외를 던지지 않는다 — 파생값이 없는 것은 화면이 '—'로 정직하게 표시한다.
 */
export async function computeDerived(contentId: string): Promise<void> {
  await computeDerivedForContents([contentId])
}

/**
 * 채널 전체의 파생값을 다시 계산한다.
 *
 * 왜 전체인가: 배수는 "같은 채널 중앙값 대비"라서, 한 콘텐츠의 지표가 새로 들어오면
 * 그 채널의 모든 콘텐츠 배수가 함께 움직인다. 한 건만 계산하면
 * 먼저 처리된 콘텐츠는 비교군이 비어 있던 시점의 값(=비어 있음)에 갇힌다.
 * (실제 사고: 채널 15건을 한꺼번에 수집했는데 전부 비교군 0으로 남음)
 *
 * ⚠️ 대상은 **삭제되지 않은 전부**다(코퍼스 밖 콘텐츠도 파생값을 갖는다).
 *    비교군으로 쓰이는 건 코퍼스 안쪽뿐이며 그 구분은 위 함수가 한다.
 */
export async function recomputeChannelDerived(channelId: string): Promise<number> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_contents')
    .select('id')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .limit(CHANNEL_RECOMPUTE_LIMIT)

  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
  return computeDerivedForContents(ids)
}

/** 코퍼스 판정을 밖에서도 쓸 수 있게 노출한다(테스트·진단용). */
export { inCorpus }
