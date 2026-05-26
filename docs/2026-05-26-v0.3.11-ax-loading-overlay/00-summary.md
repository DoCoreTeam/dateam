# FAST PATH Summary — AXLoadingOverlay 공통 컴포넌트화
작업: AI 로딩 오버레이를 공통 컴포넌트(AXLoadingOverlay)로 통합 및 전체 적용
대상:
- apps/web/components/ui/AXLoadingOverlay.tsx (신규)
- apps/web/app/globals.css (char-wave-dark keyframe 추가)
- apps/web/app/(member)/lead-intake/LeadIntakeForm.tsx
- apps/web/app/(member)/lead-intake/page.tsx
- apps/web/app/(member)/weekly-report/WeeklyReportForm.tsx
- apps/web/app/admin/reports/AdminReportsPreview.tsx
- apps/web/app/admin/content/ContentSections.tsx

이유:
- 4개 화면에서 동일한 로딩 오버레이를 각각 30~50줄씩 인라인으로 구현
- 디자인 불일치 (차파 배경색, 애니메이션 방식 상이)
- AdminReportsPreview에 <style> 태그 사용으로 hydration 위험 존재
- 유지보수 비용 과다 — 1개 변경 시 4곳 수동 수정 필요

영향:
- AXLoadingOverlay: isLoading prop 제어, light/dark variant, brandName char-wave, elapsed 타이머, forwardRef 지원
- char-wave-dark keyframe 추가 (dark variant에서 텍스트 가시성 보장)
- AdminReportsPreview의 인라인 <style>@keyframes 제거 (hydration 오류 방지)
- DC-REV 92/100 승인
