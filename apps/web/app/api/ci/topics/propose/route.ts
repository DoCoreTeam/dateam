// app/api/ci/topics/propose/route.ts — 주제 체계를 데이터에서 끌어올린다
//
// 왜 이 API가 있는가: 온보딩이 빈칸을 주고 "주제를 만드세요"라고 했다. 사용자는 '요리'
// 하나를 넣었고, 그 순간부터 시스템은 세상을 그 하나로 봤다(실측: 321건 전부 '요리').
// 사람이 맨손으로 분류 체계를 설계할 이유가 없다 — 채널을 등록하는 순간 플랫폼이
// 이미 답을 주고 있기 때문이다.
//
// 사용자는 주제를 **만드는 게 아니라 확인**한다.
// (진단: docs/2026-08-17-ci-topic-classification-replan/00-REPORT.md §7-1)

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import {
  proposeTopics, describeProposals,
  type ChannelForProposal,
} from '@/lib/ci/analysis/topic-proposal'
import type { ChannelIdentity } from '@/lib/ci/analysis/channel-identity'
import { runChannelIdentity } from '@/lib/ci/jobs/stages'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 한 번에 만들 수 있는 주제 수. 이보다 많으면 체계가 아니라 목록이다. */
const MAX_CREATE = 12

const Body = z.object({
  proposals: z.array(z.object({
    name: z.string().trim().min(1).max(40),
    channelIds: z.array(z.string().uuid()).max(200),
    signalPatterns: z.array(z.string().trim().min(1).max(60)).max(8),
    categoryPatterns: z.array(z.string().trim().min(1).max(20)).max(8),
  })).min(1).max(MAX_CREATE),
})

/** identity jsonb는 `{}`(기본값)로 시작한다 — 판정 전이면 제안 재료가 아니다. */
function identityOf(raw: unknown): ChannelIdentity | null {
  const r = raw as Partial<ChannelIdentity> | null
  if (!r || typeof r !== 'object' || typeof r.sampleSize !== 'number') return null
  return {
    dominantCategory: r.dominantCategory ?? null,
    dominantCategoryLabel: r.dominantCategoryLabel ?? null,
    categoryAgreement: r.categoryAgreement ?? 0,
    topSignals: r.topSignals ?? [],
    dominantSignal: r.dominantSignal ?? null,
    keywordProfile: r.keywordProfile ?? [],
    sampleSize: r.sampleSize,
    unknownCount: r.unknownCount ?? 0,
  }
}

/** 채널별 콘텐츠 수. 제안 카드가 "이 주제로 몇 건이 들어오나"를 말하려면 필요하다. */
async function countByChannel(
  adminClient: any, workspaceId: string,
): Promise<Map<string, number>> {
  const { data } = await adminClient
    .from('ci_contents').select('channel_id')
    .eq('workspace_id', workspaceId).is('deleted_at', null)
    .limit(5000)
  const counts = new Map<string, number>()
  for (const r of ((data ?? []) as { channel_id: string | null }[])) {
    if (!r.channel_id) continue
    counts.set(r.channel_id, (counts.get(r.channel_id) ?? 0) + 1)
  }
  return counts
}

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const adminClient = createAdminClient() as any
    const [{ data: chRows }, counts] = await Promise.all([
      adminClient.from('ci_channels')
        .select('id, display_name, identity, topic_id')
        .eq('workspace_id', session.workspaceId).is('deleted_at', null),
      countByChannel(adminClient, session.workspaceId),
    ])

    const channels: ChannelForProposal[] = []
    for (const c of ((chRows ?? []) as any[])) {
      const identity = identityOf(c.identity)
      if (!identity) continue
      // 이미 주제가 붙은 채널은 제안하지 않는다 — 할 일이 없는 카드는 장식이다.
      //
      // 예전엔 **주제 이름**이 이미 있으면 제안을 뺐다(excludeExisting).
      // 그러면 "주제는 만들어졌는데 채널이 안 붙은" 상태에서 제안이 0개가 되어
      // 사용자가 화면에서 고칠 길이 사라진다(실측: 주제 3개 생성 후 채널 0곳 연결).
      // 기준은 이름이 아니라 **채널이 실제로 붙었는가**여야 한다.
      if (c.topic_id) continue
      channels.push({
        channelId: c.id,
        displayName: c.display_name ?? null,
        contentCount: counts.get(c.id) ?? 0,
        identity,
      })
    }

    const result = proposeTopics(channels)

    return ok({
      ...result,
      summaryText: describeProposals(result),
      // 판정 전 채널이 몇 곳인지 밝힌다 — 제안이 비었을 때 "왜 없는지"의 답이다
      unjudgedChannels: ((chRows ?? []) as any[]).length - channels.length,
    })
  } catch (e) {
    return failUnexpected(e)
  }
}

export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '제안 내용을 확인해 주세요', parsed.error.issues)

    const adminClient = createAdminClient() as any
    const createdTopics: { id: string; name: string }[] = []
    const touchedChannels = new Set<string>()
    const skipped: string[] = []

    for (const p of parsed.data.proposals) {
      const { data: inserted } = await adminClient.from('ci_topics').insert({
        workspace_id: session.workspaceId,
        name: p.name,
        slug: p.name.toLowerCase().replace(/\s+/g, '-'),
      }).select('id, name').single()

      // 같은 이름이 이미 있으면 **새로 만들지 않고 그것을 쓴다.**
      // 예전엔 여기서 그냥 건너뛰었다. 그러면 주제만 만들어지고 채널이 안 붙은 상태(실측)가
      // 다시 눌러도 영영 안 고쳐진다 — "이미 있어 건너뜀"은 사용자에게 아무 길도 남기지 않는다.
      // 같은 이름 주제를 둘 만들지 않는다는 원칙은 그대로다.
      let topic = inserted as { id: string; name: string } | null
      let isNew = Boolean(topic?.id)
      if (!topic?.id) {
        const { data: existing } = await adminClient.from('ci_topics')
          .select('id, name')
          .eq('workspace_id', session.workspaceId).eq('name', p.name)
          .is('deleted_at', null).maybeSingle()
        topic = (existing as { id: string; name: string } | null) ?? null
        isNew = false
      }
      if (!topic?.id) { skipped.push(p.name); continue }
      if (isNew) createdTopics.push({ id: topic.id, name: topic.name })
      else skipped.push(p.name)

      // 규칙을 함께 넣는다. 규칙 없는 주제는 다음 게시물부터 다시 못 알아본다.
      // 이미 있던 주제면 규칙은 건드리지 않는다(사람이 손봤을 수 있다).
      const rules = isNew ? [
        ...p.signalPatterns.map((pattern) => ({ topic_id: topic!.id, kind: 'signal', pattern })),
        ...p.categoryPatterns.map((pattern) => ({ topic_id: topic!.id, kind: 'category', pattern })),
      ] : []
      if (rules.length > 0) await adminClient.from('ci_topic_rules').insert(rules)

      // 채널에 붙인다. 사람이 이미 확정한 채널은 건드리지 않는다.
      if (p.channelIds.length > 0) {
        const { data: updated } = await adminClient.from('ci_channels').update({
          topic_id: topic.id,
          topic_confidence: 1,
          // 'auto'가 아니라 'user'다 — 이 주제는 사람이 제안을 보고 확인해 만든 것이다.
          // 'auto'로 두면 곧바로 이어지는 채널 재판정이 표본이 얇은 채널(1건짜리)에서
          // 자동 판정에 실패해 **방금 사람이 붙인 주제를 null로 덮는다**(실측: 5곳 중 2곳 유실).
          topic_source: 'user',
        }).in('id', p.channelIds)
          .eq('workspace_id', session.workspaceId)
          // 사람이 확정한 채널만 건너뛴다.
          // `.neq('topic_source','user')`만 쓰면 안 된다 — SQL에서 NULL <> 'user'는 참이 아니라
          // NULL이라, **아직 아무도 정하지 않은 채널이 통째로 빠진다**(실측: 9곳 중 0곳만 갱신됐다).
          .or('topic_source.is.null,topic_source.neq.user')
          .select('id')
        // **실제로 갱신된 채널만** 센다. 요청에 실린 id를 그대로 세면 없는 채널·남의 채널·
        // 사람이 이미 확정한 채널까지 "붙였습니다"에 들어가 화면이 거짓말을 한다
        // (실측: 존재하지 않는 uuid 하나를 보냈더니 "채널 1곳에 붙였습니다"가 떴다).
        for (const c of ((updated ?? []) as { id: string }[])) touchedChannels.add(c.id)
      }
    }

    // 채널을 그 자리에서 다시 판정한다 — 상속이 여기서 일어나 소속 게시물이 함께 풀린다.
    //
    // 예전엔 잡으로 걸었다. 그러면 사용자가 주제를 만든 직후 화면은 여전히 옛 분류를 보여 주고,
    // 큐가 브라우저에서 돌아 반영되기까지 몇 분이 걸린다("빨리 고쳤으면 빨리 변경이 되어야지").
    // 재분류가 채널당 한 번의 읽기 + 병렬 쓰기로 바뀌어(reclassifyChannelContents)
    // 311건짜리 채널도 1초 안에 끝나므로 요청 안에서 끝낼 수 있다.
    for (const channelId of Array.from(touchedChannels)) {
      await runChannelIdentity(session.workspaceId, channelId).catch(() => null)
    }

    return ok({
      created: createdTopics,
      channels: touchedChannels.size,
      skipped,
    })
  } catch (e) {
    return failUnexpected(e)
  }
}
