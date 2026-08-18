// lib/ci/queries/media.ts — 영상 실체 이해 조회 SSOT
//
// 저장은 워커(ci_content_media), 표시 형태는 format/media-info.ts 하나만 쓴다.
// 화면마다 행을 직접 읽어 각자 포맷하면 같은 값이 화면마다 달라진다.

import { createAdminClient } from '@/lib/supabase/server'
import { toMediaInfo, type MediaRow } from '../format/media-info.ts'
import type { CiMediaInfo } from '../contracts.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SELECT = `
  content_id, transcript, on_screen_text, beats, hook_device, hook_message, ending,
  cut_count, pacing, shot_types, aspect, has_subtitle, subtitle_style, audio_style,
  setting, people_count, topic_guess, topic_evidence, why_it_works, replicable_formula,
  access_method, evidence, analyzed_at
`

/** 콘텐츠 1건. 아직 안 읽었으면 null — 없는 것을 있는 척 채우지 않는다. */
export async function getMedia(
  workspaceId: string,
  contentId: string,
): Promise<CiMediaInfo | null> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_content_media').select(SELECT)
    .eq('workspace_id', workspaceId).eq('content_id', contentId)
    .maybeSingle()
  return data ? toMediaInfo(data as MediaRow) : null
}

/** 목록용 일괄 조회. 안 읽은 id는 키가 아예 없다. */
export async function getMediaMap(
  workspaceId: string,
  contentIds: string[],
): Promise<Record<string, CiMediaInfo>> {
  if (contentIds.length === 0) return {}
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_content_media').select(SELECT)
    .eq('workspace_id', workspaceId).in('content_id', contentIds)

  const out: Record<string, CiMediaInfo> = {}
  for (const row of (data ?? []) as MediaRow[]) out[row.content_id] = toMediaInfo(row)
  return out
}
