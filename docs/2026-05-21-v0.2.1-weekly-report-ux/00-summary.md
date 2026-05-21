# FAST PATH Summary — v0.2.1 주간보고 UX 개선

작업: 배너 버튼 glow 애니메이션 + 첫 작성 스포트라이트 온보딩
대상: dashboard/page.tsx, WeeklyReportForm.tsx, 신규 SpotlightOnboarding.tsx, WeeklyReportBannerButton.tsx
이유: 금요일 미작성 시 주간보고 작성 유도, 첫 사용자 온보딩 UX 제공
영향:
  - dashboard/page.tsx — WeeklyReportBannerButton 클라이언트 컴포넌트 사용으로 교체
  - WeeklyReportForm.tsx — 첫 행 필드에 ID 추가, 온보딩 재실행 버튼 2곳 추가
  - 신규: components/ui/SpotlightOnboarding.tsx — 4단계 spotlight + tooltip
  - 신규: components/ui/WeeklyReportBannerButton.tsx — glow 조건부 client component
