# FAST PATH Summary

작업: globals.css 미커밋 → 프로덕션 CSS 완전 누락 수정
대상: apps/web/app/globals.css, apps/web/app/(member)/weekly-report/DailyTaskSelector.tsx, apps/web/components/ui/SpotlightOnboarding.tsx
이유: GPU 가격관리 페이지에 사용된 .gpu-* CSS 클래스가 globals.css에 정의되어 있으나 이전 커밋에 포함되지 않아 Vercel 프로덕션에서 CSS가 전혀 적용되지 않음
영향: GPU 가격관리 페이지 레이아웃 정상화, 주간보고/스팟라이트 온보딩 UI 변경사항 포함
