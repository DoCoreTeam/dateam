# 02 Task Breakdown
(.ralph/fix_plan.md 와 동기화)

## Phase 1 데이터
- P1-1 마이그레이션 080: gpu_products strategic_price_krw + override 메타, audit action_type 'strategic_price_set'
- P1-2 buildCatalog 확장: strategic_krw(fallback), is_strategic_set, effective_margin_pct, market_deviation_pct, market_median_krw
- P1-3 lib/gpu/price-signal.ts (3색 임계 SSOT)
- P1-4 lib/gpu/format-price.ts (fmtKRW/fmtUSD SSOT, 중복 제거)

## Phase 2 API
- P2-1 PATCH strategic-price (set/clear, admin+audit+revalidate)
- P2-2 콕핏 데이터 병합(products 파생 + market median)

## Phase 3 UI 콕핏
- P3-1 신규 탭 등록(가격표 유지)
- P3-2 콕핏 테이블 6컬럼 + 3색 + table-card
- P3-3 전략가 인라인 편집(연필)+fallback 흐림
- P3-4 행 펼침 Drawer(공시/시장 min-max/공급사/이력)
- P3-5 60대 간결: 폰트↑, 장황카피 제거(188/719/750/1022)

## Phase 4 통합·토큰·정책
- P4-1 catalog → strategic 흡수
- P4-2 토큰(--fs-price 등)+.price-cockpit-* 공용클래스
- P4-3 CLAUDE.md 정책 보강
- P4-4 status-colors PRICE_SIGNAL

## Phase 5 검증
- P5-1 tsc/design/단위
- P5-2 E2E
- P5-3 DC-QA/SEC/REV
- P5-4 버전·docs·commit

## 의존성
P1(데이터·파생) → P2(API) → P3(UI) → P4(통합/토큰) → P5. 한 루프 내 일괄.
