# FAST PATH Summary
작업: 사이드바 "프로젝트관리" 카테고리를 admin 역할 전용으로 제한
대상: apps/web/app/(member)/layout.tsx (line 93)
이유: 일반 유저에게 프로젝트 관리 메뉴(거래처/담당자/영업기회/리드 인테이크)가 노출되어 있음 — 완전 비노출 요구
영향: MobileShell groups prop 조건부 렌더링만 변경, 라우트 보호는 별도 작업
