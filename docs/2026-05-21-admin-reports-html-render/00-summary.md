# FAST PATH Summary
작업: 어드민 주간보고 취합 테이블에서 Tiptap HTML 태그 그대로 노출되는 버그 수정
대상: apps/web/app/admin/reports/page.tsx
이유: 성과/계획/이슈 컬럼이 {report.performance}로 문자열 렌더링 → HTML 태그 노출
영향: 없음 (표시 방식만 변경, 데이터 저장 무영향)
