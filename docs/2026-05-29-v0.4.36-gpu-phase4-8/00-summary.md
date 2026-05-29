# FAST PATH Summary — v0.4.36

작업: GPU 가격관리 Phase 4-8 — AI 리뷰 게이트·재고/문의·통합입력 + 보안 수정

## 대상 파일

### 신규 생성
- `apps/web/app/api/pricing/gpu/availability/route.ts` — 가용량 응답 GET/POST
- `apps/web/app/api/pricing/gpu/inventory/route.ts` — 모델별 재고 현황 집계 GET
- `apps/web/app/(member)/pricing/gpu/tabs/InventoryTab.tsx` — 재고/문의 탭 UI
- `apps/web/lib/auth/requireAdminApi.ts` — API 라우트용 admin 권한 검증 헬퍼
- `supabase/migrations/032_audit_action_types.sql` — audit_logs action_type CHECK 확장

### 수정
- `apps/web/app/api/pricing/gpu/review/route.ts` — POST에 admin gate 추가
- `apps/web/app/api/pricing/gpu/review/[id]/route.ts` — admin gate + supply_quotes INSERT를 adminClient로 전환 (RLS 수정)
- `apps/web/app/api/pricing/gpu/review/[id]/recheck/route.ts` — admin gate 추가
- `apps/web/app/api/pricing/gpu/pool-stock/route.ts` — admin gate + direct_prices 쓰기를 adminClient로 전환 (RLS 수정)
- `apps/web/app/api/pricing/gpu/availability/route.ts` — POST에 admin gate 추가
- `apps/web/app/(member)/pricing/gpu/tabs/ReviewTab.tsx` — 항목별 신뢰도 체크박스 + AI 재분석 UI
- `apps/web/app/(member)/pricing/gpu/tabs/QuoteRegisterTab.tsx` — Gemini AI 통합 입력 UI
- `apps/web/app/(member)/pricing/gpu/tabs/HistoryTab.tsx` — 신규 action_type 14종 렌더링
- `apps/web/app/(member)/pricing/gpu/GpuPricingClient.tsx` — 탭 재구성 (재고/문의 탭 추가)

## 변경 이유

Phase 4-8 구현:
- AI 리뷰 게이트: 견적 텍스트 → Gemini AI 추출 → 신뢰도 기반 인간 검토 → 가격표 반영
- 재고/문의: 공급사별 가용량 72h freshness 추적 + T3 풀 재고 직접 관리
- 보안: supply_quotes·direct_prices 테이블이 service_role 전용 RLS → adminClient 전환, 모든 write 라우트에 admin role 검증 추가

## 영향

- 기존 `가격표` 탭: 변경 없음
- `변동 이력` 탭: 신규 action_type 14종 자동 렌더링
- 신규 탭: `통합 입력`(AI 분석), `검토 대기`(AI 게이트), `재고/문의`(가용량 현황)
- 보안: 운영자 전용 write API에 403 게이트 추가 (일반 member 차단)
