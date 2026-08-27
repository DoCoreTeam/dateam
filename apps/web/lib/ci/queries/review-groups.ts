// lib/ci/queries/review-groups.ts — 검토 대기를 «판정 묶음»으로 세우는 단일 구현(SSOT)
//
// 왜 이 파일이 생겼나(2026-08-27 실측):
//   검토 대기 634건 중 629건(99.2%)이 채널 하나였고, 634건 전부가 같은 사유·같은 확신도
//   (0.60 이 632건)·같은 2차 후보(「교육」 630건)였다. 634개의 판단이 아니라
//   **같은 판단 하나가 634번 복사된 것**이었다.
//
//   그런데 화면은 634줄을 늘어놓고 줄마다 드롭다운을 줬고, 「보이는 것 모두 확정」은
//   현재 페이지 20건만 처리했다 — 634건이면 32페이지를 넘겨야 끝난다.
//   목록에는 이미 영상 9,200개짜리 채널이 있다. 이 구조로는 손을 댈 수 없다.
//   (사용자 지적: "몇천 몇만건도 있는데 이게 검토필요라고 나오면 이걸 사용자가 할 수 있을까?")
//
// 그래서 검토의 단위를 «게시물»에서 «판정»으로 바꾼다.
// 같은 (채널 · 확정 주제 · 후보 주제) 를 가진 게시물은 한 장의 카드로 서고, 사람은 한 번 답한다.
// 게시물이 몇만 건이 되어도 카드 수는 **판정의 종류만큼만** 늘어난다.

import { createAdminClient } from '@/lib/supabase/server'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 한 묶음이 담을 수 있는 게시물 상한 — 카드에는 수만 보여주므로 id 는 처리할 때 다시 읽는다 */
const SCAN_LIMIT = 5000
/** 카드 하나가 보여줄 표본 — "무엇이 묶였는지" 눈으로 확인할 만큼만 */
/**
 * 묶음 하나에서 화면에 내려주는 게시물 수.
 *
 * 3이었다: 「외 596건」이 가려져 사용자가 무엇에 답하는지 볼 수 없었다.
 * 지금은 **고를 수 있어야 하므로** 보여준다 — 보이지 않는 것은 뺄 수도 없다.
 * 상한이 있는 이유는 목록 하나가 화면을 통째로 먹지 않게 하기 위해서다.
 */
const SAMPLE = 12

export interface ReviewGroupSample {
  id: string
  title: string | null
  thumbnailUrl: string | null
}

export interface ReviewGroup {
  /** 화면·API가 이 묶음을 가리키는 열쇠. (채널·확정주제·후보주제)로 만든다 */
  key: string
  channelId: string | null
  channelName: string
  /** AI 가 고른 주제 */
  topicId: string
  topicName: string
  /** 갈린 상대 주제 — 없을 수도 있다 */
  altTopicId: string | null
  altTopicName: string | null
  count: number
  /** 왜 갈렸는지 — 묶음 안에서 같은 문장이므로 대표 하나면 된다 */
  reason: string
  samples: ReviewGroupSample[]
  /**
   * 이 묶음이 채널 전체를 대표하는가.
   * 참이면 답을 «이 채널의 게시물 주제»로 굳혀 다음부터 묻지 않는다.
   */
  channelWide: boolean
}

/** 판정 사유에서 사람이 읽을 한 줄을 뽑는다. 없으면 조용히 비운다 — 지어내지 않는다 */
function reasonOf(basis: any): string {
  const rungs = Array.isArray(basis?.rungs) ? basis.rungs : []
  const l0 = rungs.find((r: any) => r?.level === 'L0' && r?.ok)
  const l2 = rungs.find((r: any) => r?.level === 'L2' && r?.ok)
  const parts = [l0?.detail, l2?.detail].filter((s: unknown): s is string => typeof s === 'string' && s.length > 0)
  return parts.join(' · ')
}

/**
 * 검토 대기 게시물을 판정 묶음으로 세운다.
 *
 * 채널 안에서 확정 주제가 갈리면 카드도 갈린다 — 한 채널이 늘 카드 하나인 것은 아니다.
 */
export async function listReviewGroups(workspaceId: string): Promise<ReviewGroup[]> {
  const db = createAdminClient() as any

  const { data } = await db
    .from('ci_contents')
    .select('id, title, thumbnail_url, channel_id, topic_id, secondary_topic_ids, topic_basis, ci_channels ( display_name ), ci_topics ( name )')
    .eq('workspace_id', workspaceId)
    .eq('review_state', 'pending')
    .is('deleted_at', null)
    .limit(SCAN_LIMIT)

  const rows = (data ?? []) as any[]
  if (rows.length === 0) return []

  // 후보 주제 이름을 한 번에 읽는다 — 행마다 조회하면 수백 번 왕복한다
  const altIds = new Set<string>()
  for (const r of rows) {
    const first = Array.isArray(r.secondary_topic_ids) ? r.secondary_topic_ids[0] : null
    if (first) altIds.add(first)
  }
  const nameOf = new Map<string, string>()
  if (altIds.size > 0) {
    const { data: ts } = await db.from('ci_topics').select('id, name').in('id', Array.from(altIds))
    for (const t of (ts ?? []) as any[]) nameOf.set(t.id, t.name)
  }

  // 채널별 전체 게시물 수 — "이 묶음이 채널 전체인가"를 판단하는 분모다
  const chTotal = new Map<string, number>()
  {
    const chIds = Array.from(new Set(rows.map((r) => r.channel_id).filter(Boolean))) as string[]
    for (const id of chIds) {
      const { count } = await db
        .from('ci_contents').select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId).eq('channel_id', id).is('deleted_at', null)
      chTotal.set(id, count ?? 0)
    }
  }

  interface Agg {
    channelId: string | null; channelName: string
    topicId: string; topicName: string
    altTopicId: string | null; altTopicName: string | null
    count: number; reason: string; samples: ReviewGroupSample[]
  }
  const groups = new Map<string, Agg>()

  for (const r of rows) {
    if (!r.topic_id) continue          // 주제가 없으면 답할 것도 없다
    const alt = (Array.isArray(r.secondary_topic_ids) ? r.secondary_topic_ids[0] : null) as string | null
    const key = `${r.channel_id ?? 'none'}::${r.topic_id}::${alt ?? 'none'}`

    const g = groups.get(key) ?? {
      channelId: r.channel_id ?? null,
      channelName: r.ci_channels?.display_name ?? '채널 미확인',
      topicId: r.topic_id,
      topicName: r.ci_topics?.name ?? '주제 미확인',
      altTopicId: alt,
      altTopicName: alt ? nameOf.get(alt) ?? null : null,
      count: 0,
      reason: reasonOf(r.topic_basis),
      samples: [] as ReviewGroupSample[],
    }
    g.count++
    if (g.samples.length < SAMPLE) {
      g.samples.push({ id: r.id, title: r.title ?? null, thumbnailUrl: r.thumbnail_url ?? null })
    }
    groups.set(key, g)
  }

  return Array.from(groups.entries())
    .map(([key, g]) => ({
      key,
      ...g,
      // 채널 게시물의 절반을 넘으면 그 채널의 성격을 말하는 묶음이다 —
      // 이때만 답을 규칙으로 굳힌다. 몇 건짜리 우연을 채널 규칙으로 만들지 않는다.
      channelWide: Boolean(g.channelId) && g.count >= 8
        && g.count >= (chTotal.get(g.channelId!) ?? 0) * 0.5,
    }))
    // 큰 묶음이 위로 — 하나를 처리하면 큐가 가장 많이 줄어드는 순서다
    .sort((a, b) => b.count - a.count)
}

/** 묶음 열쇠를 되읽는다. 화면이 보낸 값을 그대로 믿지 않는다 */
export function parseGroupKey(key: string): { channelId: string | null; topicId: string; altTopicId: string | null } | null {
  const parts = key.split('::')
  if (parts.length !== 3) return null
  const [ch, topic, alt] = parts
  if (!topic || topic === 'none') return null
  return {
    channelId: ch === 'none' ? null : ch,
    topicId: topic,
    altTopicId: alt === 'none' ? null : alt,
  }
}
