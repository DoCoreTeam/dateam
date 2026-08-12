// lib/ci/analysis/context-enrich.ts — 게시 맥락 채우기 (서버 전용)
//
// 게시 시각 + 채널 국가 → 계절·요일·시간대·지역, 그리고 그날의 날씨.
// 날씨는 실패해도 나머지를 막지 않는다 — 있으면 좋고, 없으면 없다고 둔다.

import { createAdminClient } from '@/lib/supabase/server'
import { buildTemporalContext, COUNTRY_INFO } from './temporal.ts'
import { fetchDayWeather } from '../connectors/weather.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 한 번에 맥락을 채울 콘텐츠 수. 날씨 호출이 붙으므로 보수적으로 둔다. */
export const CONTEXT_MAX_PER_PASS = 20

/**
 * 콘텐츠 한 건의 맥락을 채운다.
 * 게시 시각이 없으면 아무것도 하지 않는다 — 없는 시각으로 계절을 지어내지 않는다.
 */
export async function enrichContentContext(contentId: string): Promise<boolean> {
  const adminClient = createAdminClient() as any

  const { data: c } = await adminClient
    .from('ci_contents')
    .select('id, published_at, language, ci_channels ( country )')
    .eq('id', contentId).maybeSingle()

  if (!c?.published_at) return false

  const ctx = buildTemporalContext({
    publishedAtIso: c.published_at,
    channelCountry: c.ci_channels?.country ?? null,
    language: c.language,
  })
  if (!ctx) return false

  // 날씨는 지역을 알 때만 의미가 있다. 모르면 조회하지 않는다.
  let weather = null
  if (ctx.regionKnown && ctx.countryCode) {
    const info = COUNTRY_INFO[ctx.countryCode]
    if (info) {
      weather = await fetchDayWeather({
        lat: info.lat, lon: info.lon, date: ctx.localDate, regionLabel: info.label,
      })
    }
  }

  await adminClient.from('ci_contents').update({
    local_date: ctx.localDate,
    season: ctx.season,
    weekday: ctx.weekday,
    day_part: ctx.dayPart,
    country_code: ctx.countryCode,
    country_source: ctx.countrySource,
    region_known: ctx.regionKnown,
    weather,
  }).eq('id', contentId)

  return true
}

/** 맥락이 비어 있는 콘텐츠를 훑어 채운다 — 크리에이티브·채널메타와 같은 자가치유 방식. */
export async function enrichContextBacklog(workspaceId: string): Promise<number> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_contents')
    .select('id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .is('season', null)
    .not('published_at', 'is', null)
    .limit(CONTEXT_MAX_PER_PASS)

  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
  let done = 0
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    if (await enrichContentContext(id)) done += 1
  }
  return done
}
