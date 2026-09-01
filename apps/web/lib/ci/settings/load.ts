// lib/ci/settings/load.ts — 설정 한 개를 해석해서 읽는 단일 구현 (서버 전용)
//
// 왜 따로 두는가: 설정은 scope(전역·워크스페이스·사용자)가 겹쳐 쌓이므로
// **읽는 방법 자체가 로직**이다. 그걸 화면마다 다시 쓰면 어떤 화면은 전역값을,
// 어떤 화면은 워크스페이스값을 보게 되어 같은 설정이 자리마다 다르게 동작한다.
// (재사용·단일구현 정책)

import { createAdminClient } from '@/lib/supabase/server'
import { resolveSettings, getResolved, type SettingRow } from './resolve.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 워크스페이스 기준으로 설정 한 개를 읽는다. 못 읽으면 `undefined` —
 * **기본값을 여기서 지어내지 않는다.** 호출부가 자기 기본값을 안다.
 */
export async function loadWorkspaceSetting<T>(
  workspaceId: string,
  key: string,
): Promise<T | undefined> {
  try {
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('ci_settings').select('scope, scope_id, key, value, is_encrypted, version')
      .eq('key', key)
    const resolved = resolveSettings((data ?? []) as SettingRow[], { userId: null, workspaceId })
    return getResolved<T>(resolved, key)
  } catch {
    return undefined
  }
}
