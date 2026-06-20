# FAST PATH Summary — v0.7.217

## 작업
신뷰(통합뷰) 공급원가 상세 패널 `DetailPanel`에 **"공급가 지정"** 어포던스 이식.
사용자가 특정 공급사 견적을 판매가 기준 공급가로 직접 지정/해제할 수 있게 함(자동 최저가 override).

## 배경 (왜)
- 공급가 수동 지정 기능(`is_selected`)은 백엔드·API·가격로직·테스트까지 이미 완비되어 있었으나,
  **구뷰 `PriceTableTab`에만** 버튼이 있고 기본 활성 화면인 **신뷰 `DetailPanel`에는 누락**.
- `unified` 플래그 기본 ON → 사용자가 실제 보는 화면은 `DetailPanel`인데 지정 버튼이 없어 "최저가 자동"만 가능했음.
- CLAUDE.md "실제 렌더 경로 우선 수정" 정책에 해당하는 구뷰/신뷰 공존 누락 사고 유형.

## 수정 파일
- `apps/web/components/pricing/gpu/unified/DetailPanel.tsx`
  - `QuoteRow`에 `is_selected` 추가, `useSWRConfig`+`mutateGpu` 도입
  - `toggleDesignate()` 핸들러 — 기존 `POST /api/pricing/gpu/quotes/[id]/select` 재사용
  - 공급원가 견적 행에 "공급가 지정/지정 해제" 버튼 + "✓ 지정 공급가" 배지
  - `basisSourceLabel` — `basis='selected'` → "지정 공급가" 출처 라벨
- `apps/web/lib/gpu/terms.ts` — `designatedCost`/`designateCost`/`undesignateCost` 용어 추가(SSOT)
- `apps/web/app/globals.css` — `.gpu-udetail-rowacts` 액션셀 레이아웃 1줄(기존 `gpu-btn-select`/`gpu-badge-selected` 재사용)

## 변경 없음 (재사용)
- DB(`supply_quotes.is_selected`, migration 054), select API, `lib/gpu/pricing.ts` 채택 override 로직, 단위 테스트 — 전부 기존 자산 그대로 사용.

## 영향
- 지정 시 `mutateGpu`로 cockpit 캐시까지 무효화 → 좌측 목록 판매가/기준이 즉시 갱신.
- 권한: select 라우트는 `requireAdminApi`(관리자) — 구뷰와 동일 동작(파리티 유지).
- 구뷰 `PriceTableTab`은 롤백 경로로 그대로 두어 일관성 유지.
