# 01. 테마 시스템 아키텍처 (기획 — 구현 0)

> 아래 코드 블록은 **설계 예시**. 이번 작업에서 구현하지 않는다.

## A. 토큰셋 구조 — `[data-theme]` 셀렉터 (DC-RES 표준)
globals.css에서 토큰 **이름은 고정, 값만 테마별로 재선언**. 컴포넌트는 손대지 않음.

```css
/* 기본(=classic) */
:root {
  --brand:#6366f1; --ink:#0f172a; --border-color:#e2e8f0;
  --border-w:1px; --radius:0.75rem;
  --shadow-md:0 1px 3px rgba(0,0,0,.08);
  /* …status/semantic 토큰 동일 이름 */
}
/* Neo-brutalism 오버라이드 */
[data-theme="nb"] {
  --brand:#7c3aed; --ink:#0a0a0a; --border-color:#0a0a0a;
  --border-w:3px; --radius:4px;
  --shadow-md:4px 4px 0 0 #0a0a0a;
}
/* 향후 테마는 블록 1개 추가 */
[data-theme="minimal"] { … }
```
※ **현재 :root에 NB 값이 들어있음** → 마이그레이션: NB 값을 `[data-theme="nb"]`로 옮기고 `:root`(classic)에 기존 인디고 값 복원. classic 값은 git 히스토리(브릿지 이전 커밋 0de8f32 등)에서 회수.

## B. 적용 메커니즘 — SSR 주입 + FOUC 방지
1. **root layout.tsx**(Server Component)에서 활성 테마를 DB에서 읽어 `<html data-theme>`에 주입:
```tsx
const theme = await getActiveTheme()        // system_settings 조회
return <html lang="ko" data-theme={theme} suppressHydrationWarning>…
```
2. **깜빡임 방지**: `<head>`에 동기 인라인 스크립트(쿠키 우선 읽기) — hydration 이전·첫 페인트 이전 실행. 전역 테마라 localStorage 불필요, 쿠키는 캐시 보조.

## C. 저장/전파 — 전역(조직 단위)
브랜딩 패턴 재사용(`lib/branding.ts`의 `getBranding`과 쌍둥이):
```
system_settings: { key:'active_theme', value:'nb' }
lib/theme.ts → getActiveTheme(): system_settings 조회 (없으면 'nb' 기본)
admin 변경 → POST /api/admin/settings/theme → upsert → revalidatePath('/', 'layout')
→ 다음 요청부터 전 사용자 새 테마
```
- 사용자별 개인 테마는 **이번 범위 제외**(전역 단일). 추후 쿠키 오버라이드로 확장 가능.
- 매 요청 DB조회 부담 시 `getBranding`처럼 그대로 두거나(설정값이라 경량) 캐시.

## D. 테마 레지스트리 (확장성)
```ts
// lib/themes.ts — 단일 소스
export const THEMES = [
  { id:'classic', label:'기존 (인디고)', desc:'부드러운 카드·연회색 보더' },
  { id:'nb',      label:'Neo-brutalism', desc:'하드 보더·테이프 라벨' },
] as const
export type ThemeId = typeof THEMES[number]['id']
```
새 테마 = ① globals.css에 `[data-theme="X"]` 블록 ② THEMES 배열 항목 추가. **컴포넌트 0 수정.**

## E. admin 선택 UI (BrandingSettings 패턴 재사용)
`admin/settings`에 "디자인 테마" 섹션 추가:
- THEMES를 라디오 카드로 렌더(각 카드에 **썸네일 미리보기** — 토큰값으로 만든 미니 프리뷰 or 캡처 이미지)
- 선택→저장 시 POST → upsert → revalidate. 저장 후 "다음 로드 시 전체 반영" 안내(브랜딩과 동일).
- 미리보기 강화: 카드에 `data-theme` 스코프를 입힌 미니 샘플(버튼/카드/뱃지)로 즉시 시각 비교.

## F. 전제조건 — 토큰화 완료도 (가장 중요)
테마 전환은 **토큰을 거치는 색만** 바뀐다. 하드코딩 hex가 남은 곳은 테마 무시.
- 현황(진단): 토큰 사용률 ~36%였고 이번에 대폭 토큰화했으나 **잔여 하드코딩 존재**(예: 캘린더 page 24건, status 의미색, GPU 일부).
- 임시 방어: `[data-theme="nb"]`에도 누락 토큰을 :root와 같은 값으로 선언해두면 최소 색 깨짐 방지(DC-RES 권고).
- 항구 해결: 잔여 하드코딩 → 토큰 치환 + ESLint 가드(인라인 hex 차단). (스타일 통일 로드맵 Phase 1·재사용)

## G. next-themes vs 자체 구현
- 전역(admin→전체) 시나리오는 **자체 구현이 더 단순**(layout에서 DB 읽어 주입). next-themes는 개인 테마 위주·유지보수 정체(React19 이슈) → 비채택 권고. 자체 구현 = layout 주입 + 쿠키 no-flash 스크립트 + getActiveTheme.
