# FAST PATH Summary
작업: 원형 스피너 전체 제거 → AX사업본부 char-wave 로딩 스타일 통일
대상: WeeklyReportForm.tsx, GeminiSettings.tsx, GeminiModelPicker.tsx, AdminReportsPreview.tsx, weekly-report/page.tsx
이유: AX사업본부 브랜드 로딩(char-wave org name)이 기존 원형 스피너보다 일관성 있고 사용자 경험 우수
영향: shared AXDotLoader 컴포넌트 신규 생성, orgName prop 추가
