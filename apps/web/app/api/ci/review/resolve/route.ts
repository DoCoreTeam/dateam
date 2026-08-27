// 판정 묶음 하나에 답한다 — 게시물 전부를 **서버에서 한 번에** 정리한다.
//
// 왜 서버인가: 예전 화면은 게시물마다 POST 를 보냈다. 634건이면 왕복 634번이고,
// 그것도 한 페이지(20건)씩이라 32번을 눌러야 했다. 여기서는 요청 한 번으로 끝난다.
//
// 함께 하는 일 둘:
//   ① 이 묶음의 게시물을 고른 주제로 확정하고 검토 큐에서 내린다
//   ② 묶음이 채널을 대표하면(channelWide) 그 답을 **채널의 게시물 주제**로 굳힌다
//      → 다음에 같은 채널의 게시물이 들어와도 분류가 다시 묻지 않는다(classify.ts L1.5)

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { parseGroupKey } from '@/lib/ci/queries/review-groups'
import { reclassifyChannelContents } from '@/lib/ci/jobs/stages'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({
  /** listReviewGroups 가 준 열쇠 그대로 */
  groupKey: z.string().min(3).max(200),
  /** 사람이 고른 주제 — 묶음의 확정 주제일 수도, 갈린 상대일 수도, 제3의 주제일 수도 있다 */
  topicId: z.string().uuid(),
  /** 이 답을 채널의 기본 주제로 굳힐지. 화면이 「다음부터 묻지 않기」로 보여준다 */
  rememberForChannel: z.boolean().default(false),
  /**
   * 고른 게시물만 확정한다. 없거나 비면 묶음 전부 — **예전 호출은 그대로 동작한다**.
   *
   * 왜 필요한가: 한 채널 안에도 서로 다른 주제가 많다(실측 「장사의 신」 645건이 5개 주제).
   * 묶음은 «같은 판정»끼리 모은 것이지 «같은 내용»끼리 모은 것이 아니므로,
   * 사용자가 그 안에서 다른 것을 발견하면 빼고 답할 수 있어야 한다.
   */
  contentIds: z.array(z.string().uuid()).max(5000).optional(),
})

export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail('VALIDATION_FAILED', '요청 형식을 확인해 주세요')
    const { groupKey, topicId, rememberForChannel } = parsed.data

    const g = parseGroupKey(groupKey)
    if (!g) return fail('VALIDATION_FAILED', '이 묶음을 알아볼 수 없습니다')

    const db = createAdminClient() as any

    // 고른 주제가 이 워크스페이스의 것인지 — 남의 주제를 붙이지 않는다
    const { data: topic } = await db
      .from('ci_topics').select('id, name')
      .eq('id', topicId).eq('workspace_id', session.workspaceId).is('deleted_at', null)
      .maybeSingle()
    if (!topic) return fail('NOT_FOUND', '고르신 주제를 찾을 수 없습니다')

    // 묶음을 구성하던 것과 **같은 조건**으로 다시 세운다 —
    // 화면이 보낸 건수를 믿지 않는다. 그사이 수집이 돌아 늘었을 수도 있다.
    let q = db
      .from('ci_contents')
      .select('id', { count: 'exact' })
      .eq('workspace_id', session.workspaceId)
      .eq('review_state', 'pending')
      .eq('topic_id', g.topicId)
      .is('deleted_at', null)
    q = g.channelId ? q.eq('channel_id', g.channelId) : q.is('channel_id', null)

    const { data: targets, count } = await q.limit(5000)
    const inGroup = ((targets ?? []) as any[]).map((r) => r.id) as string[]
    // 화면이 보낸 id 를 그대로 쓰지 않고 **묶음과 교집합**을 낸다 —
    // 남의 게시물이나 이미 정리된 것을 확정하지 않기 위해서다
    const picked = parsed.data.contentIds
    const partial = Boolean(picked && picked.length > 0 && picked.length < inGroup.length)
    const ids = picked && picked.length > 0
      ? inGroup.filter((id) => picked.includes(id))
      : inGroup
    if (ids.length === 0) return fail('NOT_FOUND', '이 묶음은 이미 정리됐습니다')

    // 사람이 답한 것이므로 topic_source='user' · 확신도 1.0 · 검토 완료.
    // 주제가 바뀌었으면 그 사실도 함께 남는다(topic_id 변경).
    const patch = {
      topic_id: topic.id,
      topic_source: 'user',
      topic_confidence: 1,
      review_state: 'resolved',
    }

    // 전부 확정할 때는 **id 목록을 보내지 않고 조건으로** 갱신한다.
    //
    // 왜: PostgREST 는 필터를 URL 쿼리스트링에 싣는다. UUID 하나가 36자라
    // `.in('id', ids)` 는 500건이면 2만 자, 5,000건이면 **18만 자**가 되어 요청 자체가 죽는다.
    // 채널 하나에 게시물이 몇천~몇만 건인 경우가 이 제품의 정상 상황이므로,
    // 그때 «정리하지 못했습니다»만 뜨고 원인을 알 수 없게 된다.
    // 조건 갱신은 길이가 일정하고, limit(5000) 상한도 함께 사라진다
    // — 예전에는 5,001번째부터 조용히 남으면서 «전부 정리했다»고 말했다.
    //
    // 일부만 고른 경우에만 id 목록을 쓴다. 그때는 화면에 보이는 것뿐이라 12건 이하다.
    let upErr: unknown = null
    if (partial) {
      const r = await db.from('ci_contents').update(patch).in('id', ids)
      upErr = r.error
    } else {
      let uq = db
        .from('ci_contents')
        .update(patch)
        .eq('workspace_id', session.workspaceId)
        .eq('review_state', 'pending')
        .eq('topic_id', g.topicId)
        .is('deleted_at', null)
      uq = g.channelId ? uq.eq('channel_id', g.channelId) : uq.is('channel_id', null)
      const r = await uq
      upErr = r.error
    }
    // supabase-js 는 실패를 던지지 않고 반환한다 — 검사하지 않으면 0건 처리가 성공으로 보인다.
    // 무엇이 실패했는지 남기지 않으면 화면의 «잠시 뒤 다시 시도»만 남고 원인을 영영 못 찾는다.
    if (upErr) {
      console.error('[ci/review/resolve] 확정 실패', {
        groupKey, topicId: topic.id, ids: ids.length, error: upErr,
      })
      return fail('INTERNAL', '정리하지 못했습니다. 잠시 뒤 다시 시도해 주세요')
    }

    // 주제가 바뀐 경우에만 학습에 남긴다 — "맞다고 인정한 것"은 학습을 오염시키지 않는다
    let corrections = 0
    if (topic.id !== g.topicId) {
      // 형식은 contents/[id]/topic 과 **같아야 한다** — 학습이 두 모양을 읽지 않는다.
      // (이 자리가 field·corrected_by 라는 없는 컬럼에 쓰고 NOT NULL 인 kind 를 빠뜨려
      //  insert 가 매번 실패했다. 오류를 삼켜서 «정정은 학습에 쌓인다»가 조용히 거짓이었다)
      const rows = ids.slice(0, 500).map((id) => ({
        workspace_id: session.workspaceId,
        kind: 'topic',
        target_type: 'content',
        target_id: id,
        before_value: { topicId: g.topicId },
        after_value: { topicId: topic.id },
        actor_id: session.userId,
      }))
      const { error: corrErr } = await db.from('ci_corrections').insert(rows)
      if (corrErr) console.error('[ci/review/resolve] 정정 기록 실패', corrErr)
      else corrections = rows.length
    }

    // ② 채널에 굳힌다 — 이게 "다음부터 묻지 않는다"의 실체다
    let remembered: string | null = null
    // 일부만 고른 것은 «이 채널이 전부 같은 주제»라는 뜻이 아니다 — 그때는 굳히지 않는다
    if (rememberForChannel && !partial && g.channelId) {
      const { error: chErr } = await db
        .from('ci_channels')
        .update({
          content_topic_id: topic.id,
          content_topic_set_at: new Date().toISOString(),
          content_topic_set_by: session.userId,
        })
        .eq('id', g.channelId)
        .eq('workspace_id', session.workspaceId)
      if (!chErr) {
        remembered = topic.name
        // 굳히기만 하면 «앞으로 들어올 것»만 조용해진다. 이미 쌓여 있는 것도 지금 다시 본다 —
        // 사람이 답했는데 목록이 그대로면 눌린 것 같지 않다(조용한 성공은 고장과 구분되지 않는다).
        // 사람이 확정한 건(topic_source='user')은 이 함수가 건드리지 않는다.
        try { await reclassifyChannelContents(session.workspaceId, g.channelId) } catch { /* 부가 작업이 본 작업을 되돌리지 않는다 */ }
      }
    }

    return ok({
      // 조건 갱신은 상한이 없으므로 실제로 바뀐 수는 count 다.
      // 일부만 골랐을 때만 고른 수가 곧 처리 수다.
      resolved: partial ? ids.length : (count ?? ids.length),
      total: count ?? ids.length,
      topicName: topic.name,
      corrections,
      /** 화면이 "앞으로 이 채널은 묻지 않습니다"를 말할 수 있게 */
      remembered,
    })
  } catch (e) {
    return failUnexpected(e)
  }
}
