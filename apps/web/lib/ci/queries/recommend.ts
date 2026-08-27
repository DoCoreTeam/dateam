// lib/ci/queries/recommend.ts — "오늘 뭘 만들까"에 답하는 조회 (서버 전용)
//
// 이 파일이 존재하는 이유:
//   진단(2026-08-27) 결과 화면 13개가 전부 "지금 이 단계에 몇 건 있다"를 보여 주고 있었다.
//   어느 화면도 결론을 말하지 않아서, 판단이 통째로 사용자에게 남았다.
//   "어떤 주제로 할까"에 답하려면 떡상 + 발견 + 코호트가 동시에 필요한데
//   그 셋이 서로 다른 화면에 흩어져 있었다. **합치는 일이 시스템의 일이다.**
//
// 그래서 여기서 세 조각을 한 장의 카드로 합친다:
//   무엇을(떡상 소재) · 왜 지금(배수 + 비교군) · 근거(발견 문장 + 원본)
//
// 규칙 하나: **근거가 없으면 카드를 만들지 않는다.** 빈칸을 그럴듯하게 채우지 않는다.

import { createAdminClient } from '@/lib/supabase/server'
import { CORPUS_FILTER } from '../corpus.ts'
import { formatOutlier, OUTLIER_MIN_BASELINE } from '../format/metrics.ts'
import {
  resolveSizeBand, describeCohort, formatLabel, type CohortAxes,
} from '../analysis/cohort.ts'
import { formatDiscoveryBasis, WINNER_MIN_INDEX } from '../analysis/discovery.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RecommendCard {
  id: string
  /** 무엇을 — 소재가 된 떡상 콘텐츠 */
  title: string
  thumbnailUrl: string | null
  url: string | null
  channelName: string
  /** 왜 지금 — 문장형 지표(설계서 §4.3). 근거 부족이면 null */
  outlierText: string | null
  /** 무엇과 비교한 값인지. 숫자 옆에 반드시 붙는다 */
  cohortText: string
  publishedAt: string | null
  /** 근거 — 이 소재와 같은 주제에서 반복 확인된 발견 */
  discoveries: { id: string; statement: string; basisText: string }[]
}

export interface RecommendResult {
  cards: RecommendCard[]
  /** 이 목록이 무엇을 근거로 만들어졌는지 한 줄 */
  basisText: string
  /**
   * 왜 비었는지. 빈 화면에 이유가 없으면 사용자는 고장으로 읽는다.
   * (실측: 성공 공식 617건이 전부 보관 처리돼 화면이 조용히 0건이던 사고)
   */
  emptyReason: string | null
  /** 발견이 아직 없으면 그 사실을 말한다 — 카드는 나오되 근거 칸이 빈다 */
  discoveryNotice: string | null
}

const WINDOW_DAYS = 28

/**
 * 추천 카드를 만든다.
 *
 * 순서가 규칙이다: 떡상을 먼저 고르고(무엇을) → 코호트를 붙이고(무엇과 비교했는지)
 * → 그 주제의 발견을 붙인다(왜). 발견이 없으면 카드는 나오되 "아직 근거가 없다"고 말한다.
 */
export async function getRecommendations(
  workspaceId: string,
  opts?: { topicId?: string | null; limit?: number },
): Promise<RecommendResult> {
  const adminClient = createAdminClient() as any
  const limit = Math.min(Math.max(opts?.limit ?? 12, 1), 50)

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

  let q = adminClient.from('ci_contents')
    .select(`
      id, title, canonical_url, thumbnail_url, format, published_at, topic_id,
      ci_channels ( display_name, subscriber_count ),
      ci_content_derived ( outlier_index, outlier_baseline_n )
    `)
    .eq('workspace_id', workspaceId)
    .eq('source', CORPUS_FILTER.source)
    .eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
    .is('deleted_at', null)
    .gte('published_at', since)
    .limit(400)

  if (opts?.topicId) q = q.eq('topic_id', opts.topicId)

  const { data: rows, error } = await q
  if (error) {
    return {
      cards: [], basisText: '',
      emptyReason: `수집한 게시물을 읽지 못했습니다 — ${error.message}`,
      discoveryNotice: null,
    }
  }

  const all = (rows ?? []) as any[]

  // 떡상만 남긴다. 배수가 없거나 비교 이력이 얇으면 애초에 판정 불가다.
  const winners = all
    .filter((r) => {
      const idx = r.ci_content_derived?.outlier_index
      const base = r.ci_content_derived?.outlier_baseline_n ?? 0
      return idx != null && base >= OUTLIER_MIN_BASELINE && idx >= WINNER_MIN_INDEX
    })
    .sort((a, b) =>
      (b.ci_content_derived?.outlier_index ?? 0) - (a.ci_content_derived?.outlier_index ?? 0))
    .slice(0, limit)

  const basisText = `최근 ${WINDOW_DAYS}일 · 수집 ${all.length}건 중 평소 대비 ${WINNER_MIN_INDEX}배 이상`

  if (winners.length === 0) {
    return {
      cards: [], basisText,
      emptyReason: all.length === 0
        ? `최근 ${WINDOW_DAYS}일 안에 수집된 게시물이 없습니다. 관심 채널을 등록하면 여기에 쌓입니다.`
        : `수집한 ${all.length}건 중 평소 대비 ${WINNER_MIN_INDEX}배를 넘은 게시물이 없습니다. 기간을 넓히거나 관심 채널을 늘려 보세요.`,
      discoveryNotice: null,
    }
  }

  // 이 주제들의 살아 있는 발견을 한 번에 가져온다 (카드마다 조회하면 N번 왕복한다)
  const topicIds = Array.from(new Set(winners.map((r) => r.topic_id).filter(Boolean)))
  const discByTopic = new Map<string, RecommendCard['discoveries']>()

  if (topicIds.length > 0) {
    const { data: discs } = await adminClient.from('ci_discoveries')
      .select('id, topic_id, statement, evidence_count, channel_count')
      .eq('workspace_id', workspaceId)
      .eq('is_archived', false)
      .in('topic_id', topicIds)
      .order('channel_count', { ascending: false })
      .limit(200)

    for (const d of ((discs ?? []) as any[])) {
      const list = discByTopic.get(d.topic_id) ?? []
      if (list.length < 3) {
        list.push({
          id: d.id,
          statement: d.statement,
          basisText: formatDiscoveryBasis(d.evidence_count, d.channel_count),
        })
      }
      discByTopic.set(d.topic_id, list)
    }
  }

  const cards: RecommendCard[] = winners.map((r) => {
    const idx = r.ci_content_derived?.outlier_index ?? null
    const base = r.ci_content_derived?.outlier_baseline_n ?? 0
    const axes: CohortAxes = {
      topicId: r.topic_id ?? null,
      format: r.format ?? null,
      sizeBand: resolveSizeBand(r.ci_channels?.subscriber_count ?? null),
      windowDays: WINDOW_DAYS,
    }
    return {
      id: r.id,
      title: r.title ?? '(제목 미확인)',
      thumbnailUrl: r.thumbnail_url ?? null,
      url: r.canonical_url ?? null,
      channelName: r.ci_channels?.display_name ?? '채널 미확인',
      outlierText: formatOutlier(idx, base),
      // 축이 미확인이면 describeCohort 가 "미확인"이라고 말한다 — 숨기지 않는다
      cohortText: describeCohort(axes),
      publishedAt: r.published_at ?? null,
      discoveries: r.topic_id ? (discByTopic.get(r.topic_id) ?? []) : [],
    }
  })

  const anyDiscovery = cards.some((c) => c.discoveries.length > 0)

  return {
    cards,
    basisText,
    emptyReason: null,
    discoveryNotice: anyDiscovery
      ? null
      : '아직 "왜 잘됐는지"를 찾지 못했습니다. 같은 채널에서 떡상과 평범한 게시물이 함께 쌓여야 대조할 수 있습니다.',
  }
}

/** 화면이 포맷 라벨을 직접 만들지 않게 다시 내보낸다 (§2 재사용) */
export { formatLabel }
