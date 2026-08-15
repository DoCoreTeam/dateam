// lib/ci/queries/account-why.ts — 채널 하나의 "왜 잘 됐나"를 조립한다 (서버)
//
// 대조 자체는 순수 모듈(analysis/account-contrast)이 한다. 여기는 데이터를 모아 넘길 뿐이다.
// 통계 모집단 규칙은 CORPUS_FILTER(SSOT)를 그대로 따른다 — 수집함 단건이 섞이면
// "이 계정의 평소"가 사용자가 임의로 담은 남의 콘텐츠로 오염된다.

import { createAdminClient } from '@/lib/supabase/server'
import { applyCorpusFilter } from '../corpus.ts'
import { buildAccountContrast, type AccountContrast, type ContrastInput } from '../analysis/account-contrast.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 대조에 쓰는 최대 게시물 수. 오래된 것까지 다 넣으면 옛날 전략이 지금 판정을 흐린다. */
const MAX_ROWS = 200

export async function getAccountContrast(
  workspaceId: string,
  channelId: string,
): Promise<AccountContrast> {
  const empty = buildAccountContrast([])
  if (!workspaceId || !channelId) return empty

  try {
    const adminClient = createAdminClient() as any

    // 파생값(배수)은 별 테이블이라 콘텐츠와 함께 읽는다.
    // 모집단 조건은 복사하지 않고 SSOT를 통과시킨다 — 조건이 한 곳만 바뀌면 통계가 갈린다.
    const base = adminClient
      .from('ci_contents')
      .select('id, format, duration_sec, weekday, day_part, keywords, title, ci_content_derived(outlier_index)')
      .eq('workspace_id', workspaceId)
      .eq('channel_id', channelId)

    const { data } = await applyCorpusFilter(base)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(MAX_ROWS)

    const rows: ContrastInput[] = ((data ?? []) as any[]).map((r) => {
      // 임베드는 배열로 오거나 객체로 온다(관계 카디널리티에 따라). 둘 다 받는다.
      const d = Array.isArray(r.ci_content_derived) ? r.ci_content_derived[0] : r.ci_content_derived
      const idx = d?.outlier_index
      return {
        outlierIndex: typeof idx === 'number' ? idx : null,
        format: typeof r.format === 'string' ? r.format : null,
        durationSec: typeof r.duration_sec === 'number' ? r.duration_sec : null,
        weekday: typeof r.weekday === 'number' ? r.weekday : null,
        dayPart: typeof r.day_part === 'string' ? r.day_part : null,
        keywords: Array.isArray(r.keywords) ? r.keywords.filter((k: unknown) => typeof k === 'string') : null,
        title: typeof r.title === 'string' ? r.title : null,
      }
    })

    return buildAccountContrast(rows)
  } catch {
    // 조회가 깨졌을 때 "차이 없음"으로 보이면 거짓말이다 — 빈 결과의 이유가 그대로 뜬다.
    return empty
  }
}
