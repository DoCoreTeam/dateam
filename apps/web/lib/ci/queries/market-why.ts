// lib/ci/queries/market-why.ts — 시장 코퍼스의 "무엇이 통하나"를 조립한다 (서버)
//
// 대조와 게이트는 순수 모듈(analysis/market-contrast)이 한다. 여기는 데이터를 모아 넘길 뿐이다.
// 채널 하나짜리(`account-why.ts`)와 같은 구조를 일부러 유지한다 —
// 조립 방식이 갈리면 "같은 대조인데 다른 답"이 나온다.

import { createAdminClient } from '@/lib/supabase/server'
import { applyCorpusFilter } from '../corpus.ts'
import {
  buildMarketContrast, type MarketContrast, type MarketContrastInput,
} from '../analysis/market-contrast.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 대조에 쓰는 최대 게시물 수. 집계표(1000)와 달리 대조는 최근 것이 더 중요하다. */
const MAX_ROWS = 500

export async function getMarketContrast(
  workspaceId: string,
  windowDays: number,
  topicId?: string | null,
): Promise<MarketContrast> {
  const empty = buildMarketContrast([])
  if (!workspaceId) return empty

  try {
    const adminClient = createAdminClient() as any
    const since = new Date(Date.now() - windowDays * 86400_000).toISOString()

    let q = adminClient
      .from('ci_contents')
      .select(
        'id, format, duration_sec, weekday, day_part, keywords, title, channel_id,'
        + ' ci_channels ( display_name ), ci_content_derived ( outlier_index )',
      )
      .eq('workspace_id', workspaceId)

    q = applyCorpusFilter(q)
      // 기간 조건은 집계표(getMarketOverview)와 **같은 식**이어야 한다 —
      // 한쪽만 다르면 같은 화면에 모집단이 둘 생긴다(이번 재설계의 P0-1).
      .or(`published_at.gte.${since},and(published_at.is.null,first_seen_at.gte.${since})`)

    if (topicId) q = q.eq('topic_id', topicId)

    const { data } = await q
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(MAX_ROWS)

    const rows: MarketContrastInput[] = ((data ?? []) as any[]).map((r) => {
      // 임베드는 관계 카디널리티에 따라 배열로도 객체로도 온다. 둘 다 받는다.
      const d = Array.isArray(r.ci_content_derived) ? r.ci_content_derived[0] : r.ci_content_derived
      const ch = Array.isArray(r.ci_channels) ? r.ci_channels[0] : r.ci_channels
      const idx = d?.outlier_index
      return {
        outlierIndex: typeof idx === 'number' ? idx : null,
        format: typeof r.format === 'string' ? r.format : null,
        durationSec: typeof r.duration_sec === 'number' ? r.duration_sec : null,
        weekday: typeof r.weekday === 'number' ? r.weekday : null,
        dayPart: typeof r.day_part === 'string' ? r.day_part : null,
        keywords: Array.isArray(r.keywords) ? r.keywords.filter((k: unknown) => typeof k === 'string') : null,
        title: typeof r.title === 'string' ? r.title : null,
        channelId: typeof r.channel_id === 'string' ? r.channel_id : null,
        channelName: typeof ch?.display_name === 'string' ? ch.display_name : null,
      }
    })

    return buildMarketContrast(rows)
  } catch {
    // 조회가 깨졌을 때 "차이 없음"으로 보이면 거짓말이다 — 빈 결과의 이유가 그대로 뜬다.
    return empty
  }
}
