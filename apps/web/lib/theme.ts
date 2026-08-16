import { cache } from 'react'
import { getShellSettings } from '@/lib/settings'
import { getRequestProfile } from '@/lib/auth/request-profile'
import { DEFAULT_THEME, isThemeId, resolveTheme, type ThemeId } from '@/lib/themes'

export { resolveTheme }

// 활성 테마(전역 디폴트) — system_settings.active_theme. 브랜딩과 동일 패턴.
// cache(): 같은 요청 내 중복 호출(루트 layout + member layout) 시 1회만 조회.
export const getActiveTheme = cache(async (): Promise<ThemeId> => {
  try {
    // 브랜딩과 **같은 테이블**이라 같은 조회에 묶는다(lib/settings.ts SSOT).
    // 예전엔 각자 읽어 한 화면에 system_settings 왕복이 2~3회였다.
    const v = (await getShellSettings()).active_theme
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
    // 인증·프로필 모두 **요청당 1회** 공용 리더를 쓴다.
    // 예전엔 여기서 `auth.getUser()`와 `profiles` 조회를 직접 해서, 같은 요청에서
    // 미들웨어·그룹 레이아웃이 이미 읽은 것을 **세 번째로** 다시 읽었다.
    // (근거: docs/2026-08-16-performance-audit/PLAN.md §2-2)
    const profile = await getRequestProfile()
    return resolveTheme(profile?.theme_preference, globalDefault)
  } catch {
    return globalDefault
  }
})
