# 04 완료 기준 (라인별 ✅ 판정)

## 기능 (이번 딜리버리 — 구현 완료)
- [x] P1 통합 표(마스터·디테일) + 보기 전환(판매가·가격 결정·시장 비교·재고·고객가) 컬럼 교체
- [x] P1 저장된 보기(localStorage) — 컬럼 토글은 Phase 2
- [x] P2 우측 상세 패널(인라인 드로어 아님) + 탭(공급원가 전체견적/시장 비교+시세이력/변동 이력/스펙)
- [x] P2 인라인 수정(QuoteEditModal 연결) + 만료 D-7 신호
- [x] P3 CSV 멀티모달 입력 UI(MultimodalIntake) + 헤더 자동 매핑
- [x] P3 CSV 수식 인젝션 무력화(=/+/-/@·탭·CR·LF·선행공백) + 14 단위 테스트
- [x] P3 신뢰도 자동 게이트 로직(confidence-gate, ≥90/70~90/<70) + 테스트
- [x] P4 마스터 쓰기 admin(requireAdminApi) / member 읽기 + 메뉴 분리(탭 필터+가드)
- [x] P5 읽기 API 4개(quotes status=* · market/prices mapping_id · review iterations · audit filter)
- [x] P5 약점: 만료 D-7 신호 · 직판 마진 측정불가 신호

## Phase 2 백로그 (flag-OFF 기본 → 비차단. DECISION-20260613-phase2-backlog)
- [ ] P3-1b 통합 입력 AI 경로(텍스트·이미지·URL) 멀티모달 통합 — QuoteRegisterTab 흡수
- [ ] P3-3b AI 신뢰도 게이트 UI(AI 추출 경로 연결) + 변경분 diff
- [ ] 고객가(catalog) 축 병합(파트너 등급 선택 + 할인 적용)
- [ ] P2 일괄 견적 수정 · 컬럼 토글

## 정합성/보존
- [ ] 계산 로직 무변경(pricing·intake-routing·dedup·validate·tier-dict·buildCatalog import만)
- [ ] GPU_TERMS SSOT만 사용(하드코딩 라벨 0)
- [ ] 골든세트 무회귀

## 비기능
- [ ] 반응형(모바일 목록→상세 풀스크린) · 가로 스크롤 0
- [ ] 접근성(상태 색+텍스트 병기 · 키보드 · 대비)
- [ ] feature flag 병존(OFF 시 기존 탭)

## 게이트
- [ ] cd apps/web && pnpm exec tsc --noEmit 그린
- [ ] pnpm test 그린(신규 테스트 포함)
- [ ] pnpm design:check 그린
- [ ] Playwright E2E 그린
- [ ] DC-QA(CRITICAL/HIGH 0) · DC-SEC · DC-REV 80+
- [ ] GATE 1-5
- [ ] 버전 PATCH 업 · git commit(push/배포 안 함)
