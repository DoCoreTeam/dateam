# FAST PATH Summary
작업: GPU 가격표 탭에 파트너 등급 셀렉터 추가 — 선택 시 할인가 컬럼 인라인 표시
대상: apps/web/app/(member)/pricing/gpu/tabs/PriceTableTab.tsx, apps/web/app/api/pricing/gpu/partner-tiers/route.ts
이유: 영업팀이 파트너별 판매가를 GPU 가격표에서 즉시 확인하기 위해
영향: PriceTableTab 전용, 기존 공급가/판매가 계산 로직 무변경
