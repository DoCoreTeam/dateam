// lib/ci/queries/channel-activity.ts — 채널별 최근 활동·성과 (서버 전용)
//
// 왜 이 파일이 생겼나(2026-08-27 실측):
//   모니터링 화면은 "지켜볼 채널을 등록하면 **새 게시물과 성과 변화**를 따라갑니다"라고
//   써 놓고, 정작 화면에는 구독자 수와 「지켜보는 중」 배지뿐이었다. 변화가 **0개**였다.
//   (사용자 지적: "수집함 모니터링 같은 맥락 같은 느낌인데 이게 왜 이런식이지?")
//
//   화면이 약속한 것을 화면이 지키게 만든다. 숫자는 지어내지 않는다 —
//   비교군이 얇으면(baselineN < 8) 배수를 내지 않는 것은 기존 규칙 그대로다.

import { createAdminClient } from '@/lib/supabase/server'
import { CORPUS_FILTER } from '../corpus.ts'
import { median } from '../analysis/outlier.ts'
import { formatOutlier } from '../format/metrics.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 배수가 이 이상이면 "떡상"으로 센다 — 트렌드 떡상 탭과 같은 눈높이 */
const HIT_THRESHOLD = 2
/** 배수를 낼 수 있는 최소 비교군 — outlier.ts 와 같은 값을 쓴다(둘이 갈리면 화면이 서로를 반박한다) */
const MIN_BASELINE = 8
/** 한 번에 훑는 게시물 상한 — 채널이 늘어도 한 판이 터지지 않게 */
const SCAN_LIMIT = 2000

export interface ChannelActivity {
  /** 기간 안에 들어온 게시물 수 */
  newCount: number
  /** 그 채널의 평소 대비 중앙값 — 근거가 얇으면 null(숫자를 지어내지 않는다) */
  medianOutlierText: string | null
  /** 배수 2배 이상 건수 */
  hitCount: number
}

/**
 * 등록 채널들의 최근 windowDays 활동을 한 번에 집계한다.
 *
 * 채널마다 따로 조회하면 8곳이면 8번 왕복한다 — 한 번에 읽어 코드에서 묶는다.
 */
export async function getChannelActivity(
  workspaceId: string,
  windowDays = 28,
): Promise<Map<string, ChannelActivity>> {
  const db = createAdminClient() as any
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString()

  const { data } = await db
    .from('ci_contents')
    .select('channel_id, ci_content_derived ( outlier_index, outlier_baseline_n )')
    .eq('workspace_id', workspaceId)
    .eq('source', CORPUS_FILTER.source)
    .eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
    .is('deleted_at', null)
    // 게시 시각이 없는 것은 수집 시각으로 본다 — 안 그러면 그 채널만 통째로 빠진다
    .or(`published_at.gte.${since},and(published_at.is.null,first_seen_at.gte.${since})`)
    .limit(SCAN_LIMIT)

  const agg = new Map<string, { values: number[]; count: number; hits: number }>()
  for (const r of (data ?? []) as any[]) {
    if (!r.channel_id) continue
    const g = agg.get(r.channel_id) ?? { values: [], count: 0, hits: 0 }
    g.count++
    const idx = r.ci_content_derived?.outlier_index
    const baseN = r.ci_content_derived?.outlier_baseline_n ?? 0
    if (idx != null && baseN >= MIN_BASELINE) {
      g.values.push(Number(idx))
      if (Number(idx) >= HIT_THRESHOLD) g.hits++
    }
    agg.set(r.channel_id, g)
  }

  const out = new Map<string, ChannelActivity>()
  for (const [id, g] of Array.from(agg.entries())) {
    const m = median(g.values)
    out.set(id, {
      newCount: g.count,
      medianOutlierText: m != null ? formatOutlier(m, MIN_BASELINE) : null,
      hitCount: g.hits,
    })
  }
  return out
}
