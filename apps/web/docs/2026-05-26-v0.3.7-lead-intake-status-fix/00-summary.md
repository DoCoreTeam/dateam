# FAST PATH Summary
작업: lead-intake 히스토리 테이블 — 중복 상태 배지 제거 + company_name null 시 파일명 표시
대상: app/(member)/lead-intake/page.tsx
이유: card-header 안 배지와 상태 컬럼이 중복 표시됨. company_name이 없을 때 "-"로 표시되어 완료 인테이크가 오류처럼 보임
영향: 없음 (렌더링 전용 수정)
