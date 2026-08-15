// lib/ci/queries/channel-resolve.ts — "이 채널이 이미 있나"를 판정하는 단 하나의 자리
//
// 왜 SSOT여야 하는가: 같은 판정이 두 곳에 따로 있었다.
//   - `addChannel`(사용자가 채널 주소를 직접 넣는 길) — external_id **정확 일치만** 봤다
//   - `upsertChannel`(콘텐츠를 수집하다 채널을 알게 되는 길) — 임시키 승격까지 봤다
//
// 그래서 이런 일이 났다(실브라우저 실측, v0.7.483):
//   ① 사용자가 `youtube.com/@BBCNews`를 넣는다 → 임시키 `handle:@BBCNews`로 행 생성
//   ② 훑기가 진짜 ID를 알아내 그 행을 `UC16niRr…`로 **승격**한다
//   ③ 사용자가 **같은 주소를 다시 넣는다** → `handle:@BBCNews`로 찾으면 **없다** → 또 만든다
//   → 같은 채널이 두 행. 콘텐츠가 갈라지고 비교군이 쪼개져 배수가 망가진다.
//
// 즉 "같은 채널인가"를 한 곳에서만 판정해야 한다. 그게 이 파일이다.

import { buildChannelKey, isProvisionalKey, provisionalKeyCandidates } from '../ucm/channel-key.ts'
import type { CiPlatform } from '../types.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ChannelRef {
  platform: CiPlatform
  externalId: string | null
  handle: string | null
  profileUrl: string | null
  displayName: string | null
}

export interface ResolvedChannel {
  id: string
  external_id: string
  display_name: string | null
  subscriber_count: number | null
  /** 임시키 행을 찾아 진짜 ID로 올렸는가 — 호출부가 로그·표시에 쓴다 */
  promoted: boolean
}

const SELECT = 'id, external_id, display_name, subscriber_count'

/**
 * 이 참조에 해당하는 채널 행을 찾는다. 없으면 null(호출부가 만든다).
 *
 * 찾는 순서에 이유가 있다:
 *   1) **키 정확 일치** — 가장 확실하다
 *   2) **진짜 ID를 아는데 못 찾았다** → 옛 임시키 행이 있는지 보고, 있으면 **승격**한다
 *      (행을 새로 만들지 않는다. 만들면 그 순간 채널이 둘로 갈린다)
 *   3) **임시키뿐인데 못 찾았다** → 그 핸들로 이미 **승격된 행**이 있는지 본다
 *      (②의 반대 방향. 이 갈래가 없어서 위의 사고가 났다)
 *
 * 승격은 여기서 수행한다 — 판정과 승격이 떨어져 있으면 또 한쪽만 고치게 된다.
 */
export async function resolveExistingChannel(
  adminClient: any,
  workspaceId: string,
  ref: ChannelRef,
): Promise<ResolvedChannel | null> {
  const key = buildChannelKey({
    platform: ref.platform,
    externalId: ref.externalId,
    handle: ref.handle,
    profileUrl: ref.profileUrl,
    displayName: ref.displayName,
  })
  if (!key) return null

  const base = () => adminClient
    .from('ci_channels').select(SELECT)
    .eq('workspace_id', workspaceId)
    .eq('platform', ref.platform)
    .is('deleted_at', null)

  // ① 키 정확 일치
  const { data: exact } = await base().eq('external_id', key.externalId).maybeSingle()
  if (exact?.id) return { ...exact, promoted: false }

  // ② 진짜 ID를 아는데 없다 → 옛 임시키 행을 찾아 올린다
  if (key.source === 'platform_id') {
    const candidates = provisionalKeyCandidates({
      handle: ref.handle, profileUrl: ref.profileUrl, displayName: ref.displayName,
    })
    if (candidates.length > 0) {
      const { data: stale } = await base().in('external_id', candidates).limit(1).maybeSingle()
      if (stale?.id) {
        await adminClient.from('ci_channels')
          .update({ external_id: key.externalId })
          .eq('id', stale.id)
        return { ...stale, external_id: key.externalId, promoted: true }
      }
    }
    return null
  }

  // ③ 임시키뿐인데 없다 → 그 핸들로 **이미 승격된** 행이 있는지 본다.
  //    사용자가 같은 채널 주소를 두 번 넣었을 때 두 번째가 새 행을 만드는 것을 막는 갈래다.
  if (isProvisionalKey(key.externalId) && ref.handle) {
    const { data: promoted } = await base().eq('handle', ref.handle).limit(1).maybeSingle()
    if (promoted?.id) return { ...promoted, promoted: false }
  }

  return null
}
