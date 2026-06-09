# 04 Completion Criteria

## 기능
- [x] C1 strategic_price_krw 필드 + override 메타 신설(마이그레이션)
- [x] C2 buildCatalog 파생: strategic_krw(fallback)·is_strategic_set·effective_margin_pct·market_deviation_pct·market_median_krw
- [x] C3 콕핏 탭 한 행에 6컬럼 동시 표시
- [x] C4 전략가 인라인 편집(연필) set/clear 동작, 미입력 흐림 fallback
- [x] C5 3색 시그널(실효마진/시장편차) SSOT 표시
- [x] C6 행 펼침: 공시가·시장 min/max·공급사·이력
- [x] C7 고객판매가격표 = 전략가 출력(흡수)
- [x] C8 60대 간결: 금액폰트≥18px, 장황카피 제거(188/719/750/1022)
- [x] C9 가격표 탭 유지(콕핏 새 탭)

## 가드레일
- [x] G1 admin 게이트 — member 전략가 수정 차단
- [x] G2 audit 'strategic_price_set' 기록
- [x] G3 디자인 토큰 준수(하드코딩 0, design:check PASS), .price-cockpit-* 공용클래스 SSOT
- [x] G4 table-card 반응형, 인라인 style 금지

## 품질
- [x] Q1 tsc 0
- [x] Q2 design:check PASS
- [x] Q3 단위테스트 PASS
- [x] Q4 E2E PASS
- [x] Q5 DC-QA PASS
- [x] Q6 DC-SEC PASS
- [x] Q7 DC-REV 80+
- [x] Q8 회귀 0 (기존 sell_price_krw=auto_margin 불변)

## 마무리
- [x] M1 버전 v0.7.67 (package.json·apps/web/package.json·CLAUDE.md·AGENTS.md)
- [x] M2 CLAUDE.md 디자인정책 콕핏 조항 보강
- [x] M3 docs 갱신 + commit(push 금지)
