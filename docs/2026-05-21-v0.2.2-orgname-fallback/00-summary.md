# FAST PATH Summary
작업: orgName을 meta.org → meta.title 순으로 폴백
대상: apps/web/app/api/reports/preview/route.ts, apps/web/app/api/reports/export/route.ts
이유: meta.org가 오래된 "DATA-ALLIANCE · 신규 본부" 값으로 남아 있을 때 meta.title("AX사업본부")을 자동 사용
영향: DOCX 다운로드 및 AI 미리보기 조직 컬럼 표시 개선
