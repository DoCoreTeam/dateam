# 01 아키텍처 — 구현 설계

## 통합 지점
`app/(member)/pricing/gpu/GpuPricingClient.tsx` — 기존 탭 오케스트레이터.
feature flag `gpu_unified` 가 ON이면 board 영역을 **UnifiedTable**로 교체, OFF면 기존 탭 유지(병존·무중단).

## 신규 파일 (가산적)
```
lib/gpu/
  feature-flags.ts        # gpu_unified 등 플래그 읽기(env+localStorage 오버라이드)
  unified-views.ts        # 보기 프리셋(컬럼 descriptor) SSOT — GPU_TERMS 라벨 사용
components/pricing/gpu/unified/
  UnifiedTable.tsx        # 좌 목록(보기 전환) + 우 DetailPanel 컨테이너(마스터·디테일)
  ViewSwitcher.tsx        # 보기 프리셋 세그먼트 + 저장된 보기 + 컬럼 토글
  DetailPanel.tsx         # 우측 고정 상세(탭: 공급원가/시장 비교/변동 이력/스펙)
  MultimodalIntake.tsx    # 통합 입력(멀티모달 + 자동 게이트 + diff) — 기존 QuoteRegisterTab 로직 재사용
lib/gpu/
  csv-intake.ts           # CSV/표 파싱 + 헤더 자동 매핑 + 수식 인젝션 무력화
  confidence-gate.ts      # 신뢰도 3구간 분류(≥90/70~90/<70) — validate.ts 게이트 재사용
```

## 데이터 (기존 SWR 재사용 — 계산 X)
- 목록/상세 데이터는 기존 라우트(`/api/pricing/gpu/{cockpit,market,inventory,products,...}`) SWR 그대로.
- 보기 전환 = **클라이언트에서 컬럼 프리셋만 교체**(재요청 없음, 계산 없음).
- pricing.ts·market-median.ts·price-signal.ts 결과를 **읽어 렌더만**(R1).

## 신규 읽기 API (P5 — 읽기전용, DB 변경 없음)
- `GET /api/pricing/gpu/quotes?product_id&status=*`
- `GET /api/pricing/gpu/market/prices?mapping_id` (시계열)
- `GET /api/pricing/gpu/review/[id]/iterations`
- `GET /api/pricing/gpu/audit?product_id&actor&from&to`

## RBAC
- 마스터 쓰기 라우트(suppliers·competitors·settings POST/PATCH/DELETE): `requireAdminApi` 확인/보강.
- member 읽기 허용(GET). UI는 admin 아니면 쓰기 버튼 비활성 + 서버 재검증(이중).

## 롤백
flag OFF → 기존 탭 그대로. 신규 파일은 미사용 상태로 무해.
