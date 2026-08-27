// lib/ci/topic-assign.ts — 「사람이 게시물의 주제를 확정한다」의 단일 구현
//
// 왜 한 곳에 모으는가 (2026-08-27 실측):
//   DB 는 주 주제가 부 주제에 남아 있는 행을 거부한다
//   (23514 · ci_contents_secondary_excludes_primary · 마이그 204).
//   그런데 검토 화면이 「다른 주제로 확정」 버튼에 거는 후보는
//   **secondary_topic_ids[0] 그 자체**다(review-groups.ts L92·L123).
//   즉 사람이 그 버튼을 누르면 겹치는 것이 예외가 아니라 **정상 경로**다.
//
//   그래서 확정 경로마다 따로 처리하면 한 곳을 빠뜨리는 순간 그 화면의 확정이 영원히 죽는다.
//   실제로 그랬다 — 묶음 확정(review/resolve)은 「엔터테인먼트로 확정」이 **100% 실패**했고,
//   게시물 하나 확정(contents/[id]/topic)은 오류를 검사하지 않아
//   **성공했다고 말하면서 아무것도 바꾸지 않았다.**
//
// 마이그 204 가 정한 뜻: 부 주제 = "주 주제(topic_id)를 **제외한** 나머지".
//   그러므로 X 를 주 주제로 올릴 때 할 일은 «부 주제를 비우는 것»이 아니라
//   «부 주제에서 X 만 빼는 것»이다. 나머지 후보는 검색·필터에 그대로 쓰인다.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 서로 다른 부 주제 조합을 훑는 상한.
 * 한 번 돌 때마다 «같은 조합을 가진 행 전부»가 사라지므로, 실제로 도는 횟수는
 * 조합의 가짓수뿐이다(실측 최대 2개). 상한은 무한 루프 방지용 안전판이다.
 */
const MAX_SECONDARY_COMBOS = 50

/** 한 번의 id 지정 갱신에 실을 최대 개수 — UUID 36자 × N 이 URL 을 넘기지 않게 */
const ID_CHUNK = 200

/** 사람이 확정했을 때 게시물에 쓰는 값. 확신도 1.0 · 검토 완료. */
export function userTopicPatch(topicId: string | null) {
  return {
    topic_id: topicId,
    topic_source: 'user',
    topic_confidence: topicId ? 1 : 0,
    review_state: 'resolved',
  }
}

/** 묶음을 세울 때와 **같은 조건** — 화면이 보낸 건수를 믿지 않는다 */
export interface TopicGroupMatch {
  workspaceId: string
  /** 지금 붙어 있는 주 주제 */
  fromTopicId: string
  channelId: string | null
}

/** 어디에 적용할지 — 묶음 전체(조건) 또는 고른 것만(id) */
export type TopicScope =
  | { kind: 'group'; match: TopicGroupMatch }
  | { kind: 'ids'; ids: string[] }

/** uuid[] 를 PostgREST 리터럴로 — 배열 컬럼 비교는 `{a,b}` 모양으로 보낸다 */
function arrayLiteral(ids: string[]): string {
  return `{${ids.join(',')}}`
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

function applyGroup(q: any, m: TopicGroupMatch) {
  const base = q
    .eq('workspace_id', m.workspaceId)
    .eq('review_state', 'pending')
    .eq('topic_id', m.fromTopicId)
    .is('deleted_at', null)
  return m.channelId ? base.eq('channel_id', m.channelId) : base.is('channel_id', null)
}

/**
 * 주 주제로 올릴 주제를 대상들의 부 주제에서 뺀다. **주제를 바꾸기 전에** 부른다.
 *
 * 반환값은 오류(있으면) — supabase-js 는 실패를 던지지 않고 돌려주므로
 * 부르는 쪽이 반드시 검사해야 한다. 겹치는 것이 없으면 아무것도 하지 않고 `null`.
 *
 * 묶음(group)은 **조건으로** 지운다. id 목록을 쓰면
 *   ① UUID 36자 × 수천 건이 URL 을 넘기고
 *   ② 목록을 읽을 때 걸린 상한 너머의 행이 남아 확정 전체가 다시 거부된다.
 * 배열 값이 같은 행은 한 번에 지워지므로 도는 횟수는 조합의 가짓수뿐이다.
 */
export async function dropSecondaryOverlap(
  db: any,
  topicId: string | null,
  scope: TopicScope,
): Promise<unknown> {
  if (!topicId) return null   // 주제를 지우는 경우엔 겹칠 것이 없다

  if (scope.kind === 'ids') {
    if (scope.ids.length === 0) return null
    // 고른 것만 — 화면에 보이는 것뿐이라 수가 적다. 그래도 조각내서 보낸다.
    for (const ids of chunk(scope.ids, ID_CHUNK)) {
      const { data, error } = await db
        .from('ci_contents')
        .select('id, secondary_topic_ids')
        .in('id', ids)
        .contains('secondary_topic_ids', [topicId])
      if (error) return error

      // 결과 배열이 같은 것끼리 묶어 한 번에 쓴다
      const buckets = new Map<string, string[]>()
      for (const r of (data ?? []) as any[]) {
        const next = ((r.secondary_topic_ids ?? []) as string[]).filter((x) => x !== topicId)
        const key = next.join(',')
        buckets.set(key, [...(buckets.get(key) ?? []), r.id as string])
      }
      for (const [key, bucketIds] of Array.from(buckets)) {
        const next = key ? key.split(',') : []
        const { error: upErr } = await db
          .from('ci_contents').update({ secondary_topic_ids: next }).in('id', bucketIds)
        if (upErr) return upErr
      }
    }
    return null
  }

  for (let pass = 0; pass < MAX_SECONDARY_COMBOS; pass++) {
    const { data, error } = await applyGroup(
      db.from('ci_contents').select('secondary_topic_ids'), scope.match,
    ).contains('secondary_topic_ids', [topicId]).limit(1)
    if (error) return error

    const row = ((data ?? []) as any[])[0]
    if (!row) return null                       // 겹치는 것이 남지 않았다 — 끝

    const old = (row.secondary_topic_ids ?? []) as string[]
    const next = old.filter((x) => x !== topicId)
    const { error: upErr } = await applyGroup(
      db.from('ci_contents').update({ secondary_topic_ids: next }), scope.match,
    ).eq('secondary_topic_ids', arrayLiteral(old))
    if (upErr) return upErr
  }

  // 조합이 상한을 넘었다 — 조용히 넘어가면 다음 갱신이 23514 로 죽으므로 오류로 돌려준다
  return new Error(`부 주제 조합이 ${MAX_SECONDARY_COMBOS}가지를 넘었습니다`)
}
