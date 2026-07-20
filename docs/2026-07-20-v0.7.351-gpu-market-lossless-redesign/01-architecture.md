# 01 — Architecture

## 파이프라인 (재정의)
```
캡처(무손실+증거고정) → 결정론 우선 추출 → AI 보완(후보) → ★reconciliation 게이트★ → 자동확정/검수 라우팅 → 비교(시나리오 파생) → 회귀 코퍼스 환류
```

## 1. 캡처 — 증거고정 스냅샷 (provenance)
- `fetchUrlText`(구조화 텍스트) + 필요 시 headless 렌더 병행. **market/refresh의 15k 절단 제거**(review/stream과 동일 SSOT `fetchUrlText` 사용).
- 스냅샷 = 감사·회귀 코퍼스 원본. vision은 주추출 아님(교차검증 보조만, 이번 스프린트 제외 가능).

## 2. 결정론 우선 추출
- 파이프표(`月額 | v1|v2|v3` ↔ `サービス | m1|m2|m3`) 결정론 파싱 + **전각 ￥(U+FFE5) 정규화**.
- 라벨산문(`月額基本料金 30,000円`, `GPU利用料金 7.2円/1分`, `1,000円/100GB`) 결정론 정규식 추출.
- AI는 결정론이 구조화 못 한 잔여만. **AI가 나눗셈·환율 절대 금지**(market/refresh CLASSIFY_PROMPT 18·24행 제거 — 코드가 산술).

## 3. 데이터모델 — 1:N 요금성분 (핵심 스키마)
관측 1건 = 요금성분 N개. **신규 테이블 `market_price_components`**(append-only, obs 확장):
| 컬럼 | 의미 |
|---|---|
| observation_id (FK market_prices) | 관측 |
| component_kind | `base_fee`(계정 고정비·GPU무관) / `usage`(GPU·시간) / `storage`(용량) / `flat`(월정액 번들) |
| amount, currency | 원본 통화 금액(무손실) |
| unit | `minute|hour|day|month|year|per_gb|per_account` (per_gb·per_account 추가) |
| gpu_count | 해당 성분의 장수(base_fee는 NULL) |
| fx_rate, fx_rate_date, fx_source | 관측시점 환율 스냅샷 |
| tax_basis | excluded/included/unknown |
| provenance | 원본 출처 |
- `market_prices`는 "관측 헤더"(모델·competitor·segment·observed_at·is_latest)로 슬림화. 금액은 components가 진실.
- **validate 게이트 반전**: 기본료 라벨 = reject 아님 → `component_kind=base_fee`로 저장(gpu_product FK 없이 관측 귀속).

## 4. Reconciliation 완전성 게이트 (은폐 0)
- 스냅샷 원문에서 **결정론으로 통화토큰(¥/￥/円 + 숫자) 전수 스캔** → 각 토큰이 추출 component에 담겼는지 커버리지 검사.
- 미커버 토큰 = "미반영: <원문라인>" 강제 노출(오탐 억제 = 통화기호 동반 숫자만, 스펙숫자 640GB/400Gbps 제외).
- 미커버 존재 시 **자동확정 금지 → 검수큐**. 완전성 배지(목록심층분석 사상 이식).

## 5. 자동확정/검수 라우팅 (신뢰도)
- **결정론파서 ↔ AI 셀단위 일치 = 자동확정**(AI 자가confidence 불신). 불일치·미커버·bundle·tax unknown·stale = 검수큐.

## 6. 비교 — 시나리오 파생 (Ofgem TCR / Infracost)
- 저장은 원시 성분. **비교는 기준 시나리오**(예: GPU 1장 × 730h/월 + 스토리지 1TB)로 결정론 파생 실효 월비용.
- **번들(flat) vs 순수(usage)는 별도 트랙** — 밴드 혼입 금지(segment 격리 유지, 골든셋:116 폐기).

## 7. SSOT 정리 (선결)
- **시간계수 720/730 단일화** → `lib/gpu/hours.ts` 신설, 전 경로 import. (정책 결정: 730=1달 실시간 근사 vs 720=30일. 표준 채택값 문서 명시.)
- FX 시점: 이력=관측 스냅샷(fx_rate), 표시=최신 — confirm 경로도 스냅샷 사용.

## 활성 경로 결선 (CLAUDE.md 정책)
- review/stream(수동) + market/refresh(자동) **둘 다** 신규 결정론추출+components+reconciliation을 경유. 죽은/옛 경로 없음.
