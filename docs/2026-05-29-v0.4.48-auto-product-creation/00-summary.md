# FAST PATH Summary — v0.4.48

작업: confirm 시 DB에 없는 신규 GPU 모델 자동 생성
대상: `apps/web/app/api/pricing/gpu/review/[id]/route.ts`, `supabase/migrations/035_gpu_products_memory_nullable.sql`

이유:
- 견적서에 새 GPU 모델(B300, RTX 9090 등)이 나올 때 `product_id: null`로 적재되던 문제
- AI가 추출한 `model_name`, `memory`, `tier_suggestion`, `series` 로 gpu_products 자동 등록 후 supply_quotes에 연결

변경 내용:
1. `[id]/route.ts`: 토큰 매칭 실패 시 adminClient로 gpu_products 자동 INSERT (pricing_mode='quote' 포함)
2. `[id]/route.ts`: audit_log에 `product_auto_created` 플래그 기록
3. `035_gpu_products_memory_nullable.sql`: `memory` 컬럼 NOT NULL → NULL 허용 (견적서에 메모리 정보 없는 경우 대응)

영향: confirm route 전용 — 기존 토큰 매칭 성공 시 동작 변경 없음

E2E 테스트 결과:
- 케이스 1: memory=null 신규 모델 → 자동 생성 ✅
- 케이스 2: memory='96GB' 신규 모델 → 자동 생성 ✅
- 기존 모델 토큰 매칭 시 자동 생성 스킵 ✅
