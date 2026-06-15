# FAST PATH Summary — v0.7.128

작업: 사이드바 상단 로고·하단 사용자 계정의 수직 여백 확보 + 수직 중앙 정렬
대상:
- `apps/web/app/globals.css` — `--header-height` 56px → 64px
- `apps/web/components/ui/MobileShell.tsx` — 푸터(사용자 계정) 래퍼 padding `var(--space-3)`(12px) → `var(--space-4)`(16px) + `flex column / justify-center`

이유:
- 상단 로고가 사이드바 최상단에 거의 붙어 있고, 하단 계정도 바닥에 붙어 답답함(사용자 피드백).
- 브랜드 영역과 콘텐츠 상단바는 `--header-height`로 분리선이 한 줄로 이어짐 → 둘을 함께 키워야 정렬을 깨지 않고 로고에 여백이 생김. 64px에서 로고가 수직 중앙(상하 균등 ~14.5px).
- 하단 계정도 패딩을 늘려 바닥에서 띄우고 수직 중앙 정렬.

영향:
- `--header-height` 사용처는 2곳(사이드바 브랜드 line120 · 콘텐츠 헤더 line275)뿐 — calc/sticky 의존 없음. 둘이 함께 8px 커져 정렬 유지(좌상단 분리선 연속).
- admin 레이아웃도 동일 MobileShell 사용 → 일관 적용.
- 표시(여백)만, 로직 무변경.

검증: tsc 0 · design:check 통과(토큰만 사용) · Playwright e2e theme-system 3/3(프로필 트리거 무회귀) · 실인증 스크린샷(상단 로고 여백·중앙정렬, 하단 계정 여백, 좌상단 분리선 정렬 확인)
