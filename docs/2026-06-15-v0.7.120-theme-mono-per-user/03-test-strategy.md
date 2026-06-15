# 테스트 전략 — v0.7.120

## 단위 (node:test)
- `lib/theme.test.ts` — `resolveTheme(userPref, globalDefault)`:
  - userPref 유효 → userPref 반환
  - userPref null/undefined → globalDefault 반환
  - userPref 무효값(문자열 오타) → globalDefault 반환(폴백)
- package.json `test` 목록에 추가(자동 포함 아님).

## 타입/디자인 가드
- `pnpm exec tsc --noEmit` 0 에러
- `pnpm design:check` 통과 (mono 토큰은 globals.css :root/[data-theme] 내 정의 → 가드 예외 영역. 컴포넌트 인라인 hex 금지 준수)

## 브라우저 (Playwright MCP, 실검증 필수)
1. `/admin/settings` 진입 → 디자인 테마 카드 3개(nb/classic/mono) 각각 **서로 다른** 비주얼(스크린샷)로 렌더되는지(버그픽스 검증). 특히 전역이 classic인 상태에서도 nb·mono 카드가 자기 색/형태로 보일 것.
2. 좌하단 사용자명 클릭 → 메뉴에 "테마변경" 존재 → 호버/클릭 시 **오른쪽 서브메뉴** 노출.
3. mono 선택 → 화면 즉시 mono로 전환(`<html data-theme="mono">`).
4. **새로고침(reload)** 후에도 mono 유지(DB 영속 + SSR 주입 검증).
5. 콘솔 에러 없음.

## 회귀
- 기존 nb/classic 전역 동작 무변 — 어드민 테마 적용 정상.
