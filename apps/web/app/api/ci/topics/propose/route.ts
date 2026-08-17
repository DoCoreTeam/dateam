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
  proposeTopics, describeProposals, excludeExisting,
  type ChannelForProposal,
} from '@/lib/ci/analysis/topic-proposal'
import type { ChannelIdentity } from '@/lib/ci/analysis/channel-identity'
import { enqueueJob } from '@/lib/ci/jobs/queue'

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
    const [{ data: chRows }, { data: topicRows }, counts] = await Promise.all([
      adminClient.from('ci_channels')
        .select('id, display_name, identity')
        .eq('workspace_id', session.workspaceId).is('deleted_at', null),
      adminClient.from('ci_topics')
        .select('name').eq('workspace_id', session.workspaceId)
        .is('deleted_at', null).is('merged_into_id', null),
      countByChannel(adminClient, session.workspaceId),
    ])

    const channels: ChannelForProposal[] = []
    for (const c of ((chRows ?? []) as any[])) {
      const identity = identityOf(c.identity)
      if (!identity) continue
      channels.push({
        channelId: c.id,
        displayName: c.display_name ?? null,
        contentCount: counts.get(c.id) ?? 0,
        identity,
      })
    }

    const existingNames = ((topicRows ?? []) as { name: string }[]).map((t) => t.name)
    const result = excludeExisting(proposeTopics(channels), existingNames)

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
      const { data: topic, error: insErr } = await adminClient.from('ci_topics').insert({
        workspace_id: session.workspaceId,
        name: p.name,
        slug: p.name.toLowerCase().replace(/\s+/g, '-'),
      }).select('id, name').single()

      // 같은 이름이 이미 있으면 만들지 않는다 — 같은 이름 주제가 둘이면 분류가 갈린다
      if (insErr || !topic?.id) { skipped.push(p.name); continue }
      createdTopics.push({ id: topic.id, name: topic.name })

      // 규칙을 함께 넣는다. 규칙 없는 주제는 다음 게시물부터 다시 못 알아본다.
      const rules = [
        ...p.signalPatterns.map((pattern) => ({ topic_id: topic.id, kind: 'signal', pattern })),
        ...p.categoryPatterns.map((pattern) => ({ topic_id: topic.id, kind: 'category', pattern })),
      ]
      if (rules.length > 0) await adminClient.from('ci_topic_rules').insert(rules)

      // 채널에 붙인다. 사람이 이미 확정한 채널은 건드리지 않는다.
      if (p.channelIds.length > 0) {
        await adminClient.from('ci_channels').update({
          topic_id: topic.id,
          topic_confidence: 0.85,
          topic_source: 'auto',
        }).in('id', p.channelIds)
          .eq('workspace_id', session.workspaceId)
          .neq('topic_source', 'user')
        for (const id of p.channelIds) touchedChannels.add(id)
      }
    }

    // 채널 재판정을 잡으로 건다 — 상속이 여기서 일어나 소속 게시물이 함께 풀린다.
    // 인라인으로 돌리면 채널 하나에 수천 건이라 요청이 끊긴다.
    for (const channelId of Array.from(touchedChannels)) {
      await enqueueJob({
        workspaceId: session.workspaceId, stage: 'classify',
        targetType: 'channel', targetId: channelId, version: Date.now(),
      }).catch(() => null)
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
