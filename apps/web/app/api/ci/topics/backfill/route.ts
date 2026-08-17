// app/api/ci/topics/backfill/route.ts — 이미 담긴 게시물의 주제 신호를 다시 받아온다
//
// 왜 필요한가: 커넥터가 `topicDetails`를 요청조차 안 하던 시절에 담긴 게시물은
// platform_category·topic_signals가 비어 있다(실측 321건). 코드를 고쳐도 **이미 있는 데이터는
// 스스로 채워지지 않는다** — 채널 훑기는 새 게시물만 담고 기존 행은 건너뛰기 때문이다.
//
// 왜 일괄인가: 처음엔 게시물 1건당 수집 잡 1개를 걸었다. 321건이 **12분** 걸렸고,
// 그 12분 동안 화면은 고치기 전과 똑같았다("빨리 고쳤으면 빨리 변경이 되어야지").
// videos.list는 id를 50개까지 한 번에 받고 요금은 1유닛 그대로다 — 같은 일이 7번이면 끝난다.
// 그래서 잡을 걸지 않고 여기서 직접 채우고, 채널 재판정까지 이 요청 안에서 끝낸다.
//
// 되돌릴 수 있는 형태다: 신호를 채우고 다시 판정할 뿐, 지우는 것이 없다.
//
// **세는 조건과 훑는 조건은 같은 함수를 쓴다**(lib/ci/signal-gap.ts). 예전엔 GET이 플랫폼을
// 안 보고 POST만 youtube를 봐서, 유튜브가 아닌 게시물이 "1건 남았습니다"로 세어지면서
// 버튼은 "하나도 남지 않았어요"라고 답했다 — 눌러도 영원히 안 변하는 화면이었다.

import { createAdminClient } from '@/lib/supabase/server'
import { ok, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { getGeminiMeta } from '@/lib/ci/ai/meta'
import { fetchYoutubeSignalsBulk, VIDEOS_LIST_MAX_IDS } from '@/lib/ci/connectors/youtube'
import { runChannelIdentity } from '@/lib/ci/jobs/stages'
import { whereMissingSignals, whereRefillable } from '@/lib/ci/signal-gap'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 한 번 눌렀을 때 채울 게시물 수.
 * 50건씩 묶으므로 외부 호출은 이 수의 1/50이다(600건 = 12회 = 12유닛).
 * 서버리스 함수 시간 안에 끝나는 선으로 잡는다 — 넘치면 "이어서 처리"라고 밝힌다.
 */
const MAX_CONTENTS = 600

interface Row { id: string; external_id: string; channel_id: string | null }

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const adminClient = createAdminClient() as any
    /** 이 워크스페이스의 살아 있는 게시물 — 세 질문이 같은 모집단을 본다 */
    const inWorkspace = () => adminClient.from('ci_contents')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', session.workspaceId).is('deleted_at', null)

    const [{ count: total }, { count: missing }, { count: refillable }] = await Promise.all([
      inWorkspace(),
      whereMissingSignals(inWorkspace()),
      whereRefillable(inWorkspace()),
    ])

    return ok({
      total: total ?? 0,
      // **버튼이 실제로 채울 수 있는 것만** 센다. 셀 수 있는데 못 채우면 그 줄은 영원히 남는다.
      missingSignals: refillable ?? 0,
      // 못 채우는 것은 숨기지 않고 따로 밝힌다 — 커넥터가 없는 플랫폼의 게시물이다.
      unfillable: Math.max(0, (missing ?? 0) - (refillable ?? 0)),
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

    const adminClient = createAdminClient() as any
    const meta = await getGeminiMeta()
    if (!meta.youtubeApiKey) {
      // 키가 없으면 채울 방법이 없다. 조용히 0건으로 끝내지 않고 이유를 말한다.
      return ok({ filled: 0, scanned: 0, channels: 0, remaining: null, reason: 'no_api_key' })
    }

    // 다시 받아올 수 있는 게시물만 고른다 — GET이 센 것과 **같은 조건**이다(signal-gap SSOT).
    const { data: targets, error: targetErr } = await whereRefillable(
      adminClient.from('ci_contents')
        .select('id, external_id, channel_id')
        .eq('workspace_id', session.workspaceId).is('deleted_at', null),
    ).limit(MAX_CONTENTS)
    // 조회가 실패하면 0건으로 흘려보내지 않는다 — 정상 완료와 똑같이 보여 원인을 못 찾는다.
    if (targetErr) return failUnexpected(targetErr)

    const rows = (targets ?? []) as Row[]
    let filled = 0

    for (let i = 0; i < rows.length; i += VIDEOS_LIST_MAX_IDS) {
      const chunk = rows.slice(i, i + VIDEOS_LIST_MAX_IDS)
      const signals = await fetchYoutubeSignalsBulk(
        chunk.map((r) => r.external_id), meta.youtubeApiKey,
      ).catch(() => new Map())

      for (const row of chunk) {
        const s = signals.get(row.external_id)
        // 못 받은 것은 건너뛴다. 빈 값으로 덮어쓰면 "받아봤다"는 사실조차 사라진다.
        if (!s || (!s.platformCategory && s.topicSignals.length === 0)) continue
        const { error: upErr } = await adminClient.from('ci_contents').update({
          platform_category: s.platformCategory,
          topic_signals: s.topicSignals,
          // 키워드는 비어 있을 때만 채운다 — 수집 당시 값을 뒤늦게 덮어쓰지 않는다
          ...(s.keywords.length > 0 ? { keywords: s.keywords } : {}),
        }).eq('id', row.id).eq('workspace_id', session.workspaceId)
        if (upErr) continue
        filled++
      }
    }

    // 채널을 다시 판정한다. **이번에 채운 채널만이 아니라 워크스페이스 전체**다.
    //
    // 왜 전체인가: 신호는 지난번에 찼는데 그때 주제 체계가 없어 판정이 낡은 채로 남은 채널이 있다.
    // 손댄 채널만 돌리면 그런 채널은 영영 안 고쳐진다 — 사용자 눈에는 "눌렀는데 그대로"다.
    // 채널 수는 게시물 수와 달리 작아서(수십 단위) 전부 돌려도 이 요청 안에서 끝난다.
    // 이 안에서 소속 게시물 재분류까지 함께 일어난다.
    const { data: allChannels } = await adminClient.from('ci_channels')
      .select('id')
      .eq('workspace_id', session.workspaceId).is('deleted_at', null)
      .limit(200)

    let channels = 0
    for (const c of ((allChannels ?? []) as { id: string }[])) {
      const r = await runChannelIdentity(session.workspaceId, c.id).catch(() => null)
      if (r?.ok) channels++
    }

    // 남은 것도 **채울 수 있는 것**으로 센다. 못 채우는 것을 남은 것으로 세면
    // "한 번 더 누르면 이어서 채웁니다"가 영원히 지켜지지 않는 약속이 된다.
    const { count: remaining } = await whereRefillable(
      adminClient.from('ci_contents')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', session.workspaceId).is('deleted_at', null),
    )

    return ok({
      scanned: rows.length,
      filled,
      channels,
      // 남은 게 있으면 숨기지 않는다 — "이게 전부"로 읽히면 안 된다
      remaining: remaining ?? 0,
      reason: null,
    })
  } catch (e) {
    return failUnexpected(e)
  }
}
