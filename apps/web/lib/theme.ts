import { cache } from 'react'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_THEME, isThemeId, resolveTheme, type ThemeId } from '@/lib/themes'

export { resolveTheme }

// 활성 테마(전역 디폴트) — system_settings.active_theme. 브랜딩과 동일 패턴.
// cache(): 같은 요청 내 중복 호출(루트 layout + member layout) 시 1회만 조회.
export const getActiveTheme = cache(async (): Promise<ThemeId> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('system_settings')
      .select('value')
      .eq('key', 'active_theme')
      .single()
    const v = data?.value
    return isThemeId(v) ? v : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
})

/**
 * 실제로 렌더에 사용할 테마 — 로그인 사용자의 theme_preference 우선, 없으면 전역 디폴트.
 * 루트 layout(SSR)에서 호출 → 첫 페인트부터 정확(FOUC 없음).
 * cache(): 같은 요청 내 중복 호출 시 1회만 조회.
 */
export const getEffectiveTheme = cache(async (): Promise<ThemeId> => {
  const globalDefault = await getActiveTheme()
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return globalDefault
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('profiles')
      .select('theme_preference')
      .eq('id', user.id)
      .single()
    return resolveTheme(data?.theme_preference, globalDefault)
  } catch {
    return globalDefault
  }
})
