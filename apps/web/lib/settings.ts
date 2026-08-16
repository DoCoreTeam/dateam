// lib/settings.ts — `system_settings` 읽기 SSOT (요청당 1회)
//
// 왜 생겼나 (v0.7.492 퍼포먼스 조사):
//   같은 테이블을 서로 다른 함수가 따로 읽고 있었다.
//     · `getBranding()`  → brand_name · brand_tagline · logo_path
//     · `getActiveTheme()` → active_theme
//   둘 다 셸에서 매 요청 돌아 **한 화면에 system_settings 왕복이 2~3회**였다.
//   행 4개짜리 설정 테이블을 두 번 왕복하는 것은 순수 낭비다.
//
// 여기서 캐시는 **요청 스코프(React `cache()`)만** 쓴다.
//   예전에 `unstable_cache`를 쓰다 걷어낸 이력이 있다 — Next 14에서 Route Handler의
//   `revalidateTag`가 온전히 동작하지 않아 **관리자가 브랜딩을 바꿔도 화면이 안 바뀌는**
//   문제가 있었다. 요청 스코프는 그 문제가 아예 없다("같은 요청 안에서만 공유").
//   즉 이 변경으로 늦게 반영되는 값은 하나도 없다. 왕복만 줄어든다.

import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'

/** 셸이 매 요청 필요로 하는 설정 키. 여기 없는 키는 각자 읽는다. */
export const SHELL_SETTING_KEYS = [
  'brand_name', 'brand_tagline', 'logo_path', 'active_theme',
] as const

export type ShellSettings = Record<string, string | null>

/**
 * 셸 설정을 한 번에 읽는다. 실패하면 빈 객체 — 호출부가 기본값을 쓰게 한다.
 * (설정 조회가 실패했다고 화면이 죽으면 안 된다)
 */
export const getShellSettings = cache(async (): Promise<ShellSettings> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('system_settings')
      .select('key, value')
      .in('key', SHELL_SETTING_KEYS as unknown as string[])

    const out: ShellSettings = {}
    for (const row of (data ?? []) as { key: string; value: string | null }[]) {
      out[row.key] = row.value
    }
    return out
  } catch {
    return {}
  }
})
