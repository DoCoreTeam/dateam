import { createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_THEME, isThemeId, type ThemeId } from '@/lib/themes'

// 활성 테마(전역) — system_settings.active_theme. 브랜딩과 동일 패턴.
export const getActiveTheme = async (): Promise<ThemeId> => {
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
}
