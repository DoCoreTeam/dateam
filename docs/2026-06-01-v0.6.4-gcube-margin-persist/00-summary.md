# FAST PATH Summary — gcube 판매 마진 저장 유지
작업: GPU 마진 PATCH 저장이 RLS(service_role 전용)에 막혀 유지 안 되던 것을 admin(service_role) 클라이언트 쓰기로 수정
대상: apps/web/app/api/pricing/gpu/settings/route.ts
이유: pricing_settings 쓰기 정책은 auth.role()='service_role' 한정인데, PATCH가 일반 유저 클라이언트로 upsert → 차단 → 저장 실패 → 새로고침 시 기본값 복귀
영향: PriceTableTab.tsx(호출부 변경 없음), RLS/스키마 변경 없음. 저장 후 GET이 DB값 반환하여 유지됨
