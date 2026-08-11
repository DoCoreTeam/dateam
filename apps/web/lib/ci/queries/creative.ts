// lib/ci/queries/creative.ts — 크리에이티브("왜 터졌나") 조회 SSOT
//
// 저장은 워커(ci_content_creative), 표시 형태는 format/creative-info.ts 하나만 쓴다.
// 화면마다 행을 직접 읽어 각자 포맷하면 같은 값이 화면마다 달라진다.

import { createAdminClient } from '@/lib/supabase/server'
import { toCreativeInfo, type CreativeRow } from '../format/creative-info.ts'
import type { CiCreativeInfo } from '../contracts.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SELECT = `
  content_id, thumbnail_text, thumbnail_style, thumbnail_summary,
  hook_message, hook_type, title_pattern, evidence, model, analyzed_at
`

/** 콘텐츠 1건. 분석이 없으면 null — 없는 것을 있는 척 채우지 않는다. */
export async function getCreative(
  workspaceId: string,
  contentId: string,
): Promise<CiCreativeInfo | null> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_content_creative').select(SELECT)
    .eq('workspace_id', workspaceId).eq('content_id', contentId)
    .maybeSingle()
  return data ? toCreativeInfo(data as CreativeRow) : null
}

/** 목록용 일괄 조회. 분석이 없는 id는 키가 아예 없다(빈 객체를 만들지 않는다). */
export async function getCreativeMap(
  workspaceId: string,
  contentIds: string[],
): Promise<Record<string, CiCreativeInfo>> {
  if (contentIds.length === 0) return {}
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_content_creative').select(SELECT)
    .eq('workspace_id', workspaceId).in('content_id', contentIds)

  const out: Record<string, CiCreativeInfo> = {}
  for (const row of (data ?? []) as CreativeRow[]) {
    out[row.content_id] = toCreativeInfo(row)
  }
  return out
}
