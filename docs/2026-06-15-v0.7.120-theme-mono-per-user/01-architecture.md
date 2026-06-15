# 아키텍처 — v0.7.120

## 버그 원인 (프리뷰)
`:root`가 nb 기본값을 보유하지만 **`[data-theme="nb"]` 셀렉터 블록이 없음**. 프리뷰 카드는 `data-theme={t.id}`를 걸지만, 전역 `<html data-theme="classic">` 하위에서 `data-theme="nb"`는 매칭 룰이 없어 classic 토큰을 상속 → nb 카드가 classic처럼 보임.
→ **수정**: `[data-theme="nb"]` 블록을 명시 추가(=:root nb 토큰 미러). 그러면 조상 테마와 무관하게 각 카드가 자기 테마로 렌더.

## 컴포넌트/데이터 흐름
```
[전역 디폴트]  system_settings.active_theme  ──(admin only)── /api/admin/settings/theme  (기존)
[개인 선택]    profiles.theme_preference     ──(self only)─── /api/user/theme           (신규)

루트 layout.tsx (SSR)
  getEffectiveTheme(): 로그인 유저 profiles.theme_preference 있으면 그것, 없으면 getActiveTheme()(전역)
  → <html data-theme={effective}>  (FOUC 없음)

(member)/layout.tsx
  profiles.select(..., theme_preference) + 전역 default 조회
  → SidebarProfile currentTheme=effective 전달

SidebarProfile (client)
  "테마변경" 메뉴 → 오른쪽 flyout 서브메뉴(THEMES)
  선택 시: POST /api/user/theme → document.documentElement.dataset.theme=id (즉시 반영) → router.refresh()
```

## 신규/수정 파일
- `lib/themes.ts` — THEMES에 `mono` 1줄 추가
- `app/globals.css` — `[data-theme="nb"]` 블록(버그픽스) + `[data-theme="mono"]` 블록 추가
- `lib/theme.ts` — `resolveTheme(userPref, globalDefault)` 순수함수 + `getEffectiveTheme()` 추가
- `lib/theme.test.ts` — resolveTheme 단위테스트 (신규)
- `types/database.ts` — Profile에 `theme_preference: ThemeId | null`
- `supabase/migrations/097_profiles_theme_preference.sql` — 컬럼 추가
- `app/api/user/theme/route.ts` — 개인 테마 저장(신규, self only)
- `app/layout.tsx` — getEffectiveTheme 사용
- `app/(member)/layout.tsx` — theme_preference 조회 + SidebarProfile에 currentTheme 주입
- `components/ui/SidebarProfile.tsx` — 테마변경 서브메뉴

## 테마 토큰 계약(mono)
색: ink=#111, border=#111(hairline), shadow=transparent, accent=#FF3333(fg=#fff), brand=#111(fg=#fff)
치수: border-w/2/hairline/mobile=1px, radius/lg=0
그림자: sm/md/lg=none(플랫)
사이드바: bg=#111, fg=#fff
표면: color-bg=#fff, surface-bg=#f8f8f8, text-muted=#666
구조: .tape-title/.tape-mini/.font-tape 중립화(classic 패턴 복사)
