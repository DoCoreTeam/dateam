# FAST PATH Summary
작업: daily/page.tsx 로컬 PRIORITY_COLORS(텍스트색) → PRIORITY_TEXT_COLORS 리네임
대상: apps/web/app/(member)/daily/page.tsx (정의 1·사용 1)
이유: lib/tokens/status-colors.ts의 SSOT PRIORITY_COLORS(color/bg/border 객체)와 동명 충돌 → 혼동 제거
영향: 텍스트 색 매핑만, 동작 동일. 없음
