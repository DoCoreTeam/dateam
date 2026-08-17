// app/api/ci/topics/propose/route.ts — 주제 체계를 데이터에서 끌어올린다
//
// 왜 이 API가 있는가: 온보딩이 빈칸을 주고 "주제를 만드세요"라고 했다. 사용자는 '요리'
// 하나를 넣었고, 그 순간부터 시스템은 세상을 그 하나로 봤다(실측: 321건 전부 '요리').
// 사람이 맨손으로 분류 체계를 설계할 이유가 없다 — 채널을 등록하는 순간 플랫폼이
// 이미 답을 주고 있기 때문이다.
//
// 사용자는 주제를 **만드는 게 아니라 확인**한다.
// (진단: docs/2026-08-17-ci-topic-classification-replan/00-REPORT.md §7-1)

import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import {
  proposeTopics, describeProposals,
  type ChannelForProposal,
} from '@/lib/ci/analysis/topic-proposal'
import {
  computeChannelIdentity,
  type ChannelIdentity, type ChannelSignalSample,
} from '@/lib/ci/analysis/channel-identity'
import { runChannelIdentity } from '@/lib/ci/jobs/stages'
import {
  TopicProposalBody as Body,
  topicProposalInputMessage,
} from '@/lib/ci/analysis/topic-proposal-input'

/* eslint-disable @typescript-eslint/no-explicit-any */

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

/**
 * 채널별 콘텐츠 수 **와 신호 표본**을 한 번에 읽는다.
 *
 * 왜 신호까지 읽는가: 저장된 `identity`는 정체성 잡(runChannelIdentity)만 쓴다. 그 잡이
 * 아직 안 돈 채널은 `identity = {}`이고, 그래서 **콘텐츠가 가장 많은 채널이 제안 재료에서
 * 통째로 빠졌다**(실측 v0.7.553 G3: 채널 9곳 중 재료가 된 것은 4곳이고 그 4곳의 콘텐츠는
 * 0·1·0·0건, 빠진 5곳이 추성훈 311건·VEVO·psy 등 **콘텐츠 있는 쪽 전부**였다).
 * 제안 화면은 읽기 전용 확인 화면이다 — 배경 잡이 돌았는지에 화면의 진실이 달려 있으면 안 된다.
 * 정체성은 콘텐츠 신호에서 나오는 **파생값**이므로, 없으면 여기서 계산한다(저장하지 않는다).
 */
async function readChannelMaterial(
  adminClient: any, workspaceId: string,
): Promise<{ counts: Map<string, number>; samples: Map<string, ChannelSignalSample[]> }> {
  const { data } = await adminClient
    .from('ci_contents')
    .select('channel_id, platform_category, topic_signals, keywords')
    .eq('workspace_id', workspaceId).is('deleted_at', null)
    .limit(5000)
  const counts = new Map<string, number>()
  const samples = new Map<string, ChannelSignalSample[]>()
  for (const r of ((data ?? []) as any[])) {
    if (!r.channel_id) continue
    counts.set(r.channel_id, (counts.get(r.channel_id) ?? 0) + 1)
    const list = samples.get(r.channel_id) ?? []
    list.push({
      platformCategory: r.platform_category ?? null,
      topicSignals: Array.isArray(r.topic_signals) ? r.topic_signals : [],
      keywords: Array.isArray(r.keywords) ? r.keywords : [],
    })
    samples.set(r.channel_id, list)
  }
  return { counts, samples }
}

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const adminClient = createAdminClient() as any
    const [{ data: chRows }, { counts, samples }] = await Promise.all([
      adminClient.from('ci_channels')
        .select('id, display_name, identity, topic_id, platform')
        .eq('workspace_id', session.workspaceId).is('deleted_at', null),
      readChannelMaterial(adminClient, session.workspaceId),
    ])

    const channels: ChannelForProposal[] = []
    let assignedChannels = 0   // 이미 주제가 붙어 제안할 게 없는 채널
    let noSignalChannels = 0   // 신호가 하나도 없어 판정할 근거가 없는 채널
    for (const c of ((chRows ?? []) as any[])) {
      // 저장된 판정이 있으면 그것을 쓰고, 없으면 콘텐츠 신호로 지금 계산한다.
      // 계산 결과를 저장하지는 않는다 — 쓰기는 정체성 잡의 몫이고, 여기는 읽기 화면이다.
      const identity = identityOf(c.identity)
        ?? computeChannelIdentity(c.platform ?? 'youtube', samples.get(c.id) ?? [])
      if (identity.sampleSize === 0) { noSignalChannels += 1; continue }
      // 이미 주제가 붙은 채널은 제안하지 않는다 — 할 일이 없는 카드는 장식이다.
      //
      // 예전엔 **주제 이름**이 이미 있으면 제안을 뺐다(excludeExisting).
      // 그러면 "주제는 만들어졌는데 채널이 안 붙은" 상태에서 제안이 0개가 되어
      // 사용자가 화면에서 고칠 길이 사라진다(실측: 주제 3개 생성 후 채널 0곳 연결).
      // 기준은 이름이 아니라 **채널이 실제로 붙었는가**여야 한다.
      if (c.topic_id) { assignedChannels += 1; continue }
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
      // 제안이 비었을 때 "왜 없는지"의 답. **이유를 하나로 뭉치지 않는다** —
      // 예전엔 (전체 − 재료)를 그대로 unjudgedChannels로 냈는데, 그 숫자에는
      // '신호가 없다'와 '이미 주제가 붙었다'가 섞여 있어 사용자가 무엇을 해야 할지 알 수 없었다.
      // 앞의 것은 수집을 더 해야 하고, 뒤의 것은 아무것도 안 해도 되는 정상 상태다.
      unjudgedChannels: noSignalChannels,
      assignedChannels,
      totalChannels: ((chRows ?? []) as any[]).length,
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
    if (!parsed.success) {
      // 무엇이 틀렸는지 말해 준다 — 다섯 가지 실패가 같은 문구로 나가면 고칠 수가 없다
      return fail('VALIDATION_FAILED', topicProposalInputMessage(parsed.error.issues), parsed.error.issues)
    }

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
