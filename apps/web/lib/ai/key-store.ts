import 'server-only'

// lib/ai/key-store.ts — 키 표에 닿는 유일한 자리
//
// 이 파일이 하는 일은 하나다: 서비스롤 클라이언트를 만들어 `key-store-core` 의
// 규칙에 창구로 물려 주는 것. 규칙 자체는 거기 있고 시험도 거기서 돈다.
//
// **원문 API 키가 들어 있는 표다.** 그래서
//   - 첫 줄이 `import 'server-only'` 다. 클라이언트 번들에 끌려 들어가면 빌드가 멈춘다 (LOOP.md 7절 S3)
//   - `ai_provider_keys` 를 읽고 쓰는 질의는 이 파일 밖에 두지 않는다. 흩어지면
//     어느 자리가 원문을 응답에 싣는지 셀 수 없게 된다 (가드: lib/policy/ai-key-pool.test.ts)
//   - 서비스롤은 RLS 를 통째로 지나간다(S2). 이 모듈은 사람 확인 뒤에서만 불린다 —
//     AI 호출 경로는 이미 라우트에서 인증을 지났고, 관리자 화면은 requireAdmin 을 지난다

import { createAdminClient } from '@/lib/supabase/server'
import type { AiProviderId } from './provider-catalog'
import type { KeyPoolEntry, KeyOutcome, KeyStatePatch } from './key-pool'
import {
  readKeyPoolWith,
  recordKeyOutcomeWith,
  type KeyRow,
  type KeyStoreGateway,
} from './key-store-core'

/** 표에서 고르는 데 쓰는 칼럼만. `select('*')` 로 원문 키를 여기저기 흘리지 않는다 */
const PICK_COLUMNS = 'id, provider, label, api_key, priority, is_active, cooldown_until, disabled_reason, consecutive_failures'

function gateway(): KeyStoreGateway {
  // 생성된 Database 타입에 아직 이 표가 없다 (types/database.ts 는 재생성 전)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  return {
    async readRows(provider: AiProviderId): Promise<KeyRow[]> {
      const { data, error } = await admin
        .from('ai_provider_keys')
        .select(PICK_COLUMNS)
        .eq('provider', provider)
        .order('priority', { ascending: true })
        .order('id', { ascending: true })
      // supabase-js 는 질의 오류를 던지지 않고 돌려준다 — 검사하지 않으면 조용히 0건이 된다
      if (error) throw new Error(error.message ?? String(error))
      return (data ?? []) as KeyRow[]
    },

    async readMeta(): Promise<Record<string, unknown>> {
      const { data, error } = await admin
        .from('org_content').select('value').eq('key', 'META').single()
      if (error) throw new Error(error.message ?? String(error))
      return (data?.value ?? {}) as Record<string, unknown>
    },

    async writeState(id: string, patch: KeyStatePatch): Promise<void> {
      const { error } = await admin.from('ai_provider_keys').update({
        cooldown_until: patch.cooldownUntil,
        disabled_reason: patch.disabledReason,
        consecutive_failures: patch.consecutiveFailures,
        is_active: patch.isActive,
        last_error: patch.lastError,
        last_used_at: new Date().toISOString(),
        ...(patch.disabledReason === null && patch.consecutiveFailures === 0
          ? { last_ok_at: new Date().toISOString() }
          : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      if (error) throw new Error(error.message ?? String(error))
    },
  }
}

/** 이 공급자로 시도할 키를 순서대로. 표가 비었거나 못 읽으면 META 의 기존 키 하나 */
export async function readKeyPool(provider: AiProviderId): Promise<KeyPoolEntry[]> {
  return readKeyPoolWith(gateway(), provider, Date.now())
}

/** 호출 결말을 표에 적는다. 적다 실패해도 부르는 쪽은 멈추지 않는다 */
export async function recordKeyOutcome(
  entry: KeyPoolEntry,
  outcome: KeyOutcome,
  errorMessage?: string,
): Promise<void> {
  return recordKeyOutcomeWith(gateway(), entry, outcome, Date.now(), errorMessage)
}

export { isMetaEntry, META_ENTRY_PREFIX } from './key-store-core'
export type { KeyRow, KeyStoreGateway } from './key-store-core'
