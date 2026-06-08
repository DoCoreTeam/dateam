# 01 Architecture

## SSOT 레이어 (재사용 — 변경 최소)
- **L2 데이터 SSOT**: `lib/gpu/pricing.ts::getGpuCatalog/buildCatalog` — read-time 계산. 파생값(effective_unit_price_usd, sell_price_krw, tier) 미저장. → 수정하면 다음 조회 자동 반영.
- **캐시 무효화**: `revalidateGpu(GPU_CACHE_TAG)` — Next fetch 태그. SWR: `lib/gpu/swr-keys.ts::mutateGpu`.
- **표준 사다리 보충**: `lib/gpu/derive-configs.ts::ensureStandardConfigs`.

## 신규 단일 모듈 (SSOT)
- `lib/gpu/config-ladder.ts` (신규): `STANDARD_LADDER=[1,2,4,8]`, `roundUpToStandard(n)`, `perGpuUnitPrice(total, count)`, `priceForStandardConfig(perGpu, targetCount)`. **모든 입력경로가 이 모듈만 호출.**
- `lib/gpu/audit.ts` (신규): `recordGpuAudit(db, {actor, action, table, rowId, before, after})` — gpu_audit_logs 기록 공통.
- `lib/gpu/impact.ts` (신규): `countImpact(db, entity, id)` — 변경 영향 N건 산출(프리뷰).

## 데이터 흐름 (목표)
```
입력경로 3종 (review confirm / quotes POST / 직접 CRUD)
        │  모두 config-ladder.roundUpToStandard + perGpu 환산 경유 (SSOT)
        ▼
supply_quotes (gpu_count ∈ {1,2,4,8}, 비표준 원본은 quarantine 플래그 보존)
        │  ensureStandardConfigs 사다리 보충
        ▼
buildCatalog() read-time → 4탭 동일 파생
        │  쓰기 후: recordGpuAudit + revalidateGpu + mutateGpu(4탭+settings+fx)
        ▼
가격표·시장비교·재고·고객판매가 — 일관 + 즉시 반영
```

## DB 변경
- `supply_quotes`: `is_nonstandard_source boolean default false`(quarantine 플래그), 정규화는 앱단(올림). gpu_count CHECK는 IN(1,2,4,8)로 강화하되 원본 보존행은 별도 처리. → 안전을 위해 **앱단 정규화 우선 + 신규 입력만 CHECK** (기존행 백필 후 적용).
- 소프트삭제: 대상 테이블에 `deleted_at timestamptz` (없으면 추가). buildCatalog는 `deleted_at IS NULL`만.
- `gpu_audit_logs`: 기존 테이블 활용(있으면), before/after jsonb.

## API 레이어
- 신설: gpu_products POST, market/prices PATCH, direct-prices GET. 
- 전환: DELETE → 소프트삭제(deleted_at set) + 참조검사.
- 공통 미들: admin 게이트(createAdminClient) + recordGpuAudit + revalidateGpu + config-ladder 정규화.

## UI 레이어
- 4탭 인라인 편집/삭제 모달(공용 모달 표준) + 영향 프리뷰 다이얼로그.
- 상품 직접 등록 진입점.
