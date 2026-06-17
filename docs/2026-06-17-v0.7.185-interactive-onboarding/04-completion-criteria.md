# 04 · 완료 기준 — 실습형 인터랙티브 온보딩

> v0.7.185 기획 · 구현 완료 선언은 아래 전 항목 ✅ 후에만 (EXEC-001). 이 문서는 기획 산출물이며 **현재 코드 구현은 0** (사용자 지시: 기획만).

## A. 사전 결정 게이트 (구현 착수 전)
- [ ] D-1 실데이터 격리안(`is_onboarding` + 집계 제외) 사용자 승인
- [ ] D-2 기존 사용자 노출/백필 정책 확정
- [ ] D-3 driver.js 설치 승인(번들 예산 OK)
- [ ] D-4 P0 강제 / P1·P2 선택형 범위 합의

## B. 기능 완료 (FR 대응)
- [ ] FR-1 신규 member 최초 `(member)` 진입 시 자동 시작 (비번변경/이름설정 모달이 우선)
- [ ] FR-2 스포트라이트 + 강조 요소 **직접 클릭/입력 가능**(`disableActiveInteraction:false`)
- [ ] FR-3 실습 게이팅 — 실제 행동 완료가 다음 스텝 트리거(`moveNext()`), 행동 전 진행 불가
- [ ] FR-4 멀티페이지(/home→/daily→/org→(P2)/pricing) 전환 후 정확한 스텝 재개
- [ ] FR-5 진행상태 DB 영속화(기기/브라우저 무관 재개)
- [ ] FR-6 언제든 스킵 + 재진입(사이드바/도움말)
- [ ] FR-7 완료 처리 + 축하/요약
- [ ] FR-8 기존 SpotlightOnboarding 흡수 — 스포트라이트 구현 1벌만(SSOT)

## C. 실습별 (우선순위)
- [ ] [P0] 일일 업무 **실제 등록**되되 `is_onboarding=true`로 격리(롤업/AI/주간보고 제외)
- [ ] [P0] 프로필/조직 둘러보기 스텝
- [ ] [P1] AI 기능 1회 체험("나중에" 선택형, 기존 5-3 패턴 재사용)
- [ ] [P2] GPU 금액 확인 — **UnifiedTableConnected/PriceCockpitTab**(구 PriceTableTab 아님), 조건부 노출

## D. 데이터/오염 방지 (CRITICAL)
- [ ] 마이그레이션 113 ADD-only, 롤백 가능, 기존 행 무변경
- [ ] 온보딩 더미가 주간보고 롤업·AI 후보추출·리스트 기본뷰에서 제외됨(통합 테스트로 증명)
- [ ] RLS: onboarding 상태·온보딩 daily_log 본인만

## E. 디자인/접근성/성능
- [ ] z-index 토큰 `--z-onboarding` 신설(하드코딩 9999 제거), popover 테마 globals.css 토큰 경유(인라인 style 0)
- [ ] 반응형 320/768/1024/1440 + 라이트/다크 스포트라이트 좌표 정확, 모바일 폴백
- [ ] 키보드/ESC/포커스복원/reduced-motion/색대비 4.5:1
- [ ] driver.js effect 내 동적 import, app page JS <300KB(gz) 유지
- [ ] `pnpm design:check` 통과 + 폼/모달 표준 클래스 눈대조

## F. 테스트 (03 대응)
- [ ] `lib/onboarding/*` 단위 80%+ (새 파일 package.json test 목록 등록)
- [ ] DB/RLS 통합 테스트(격리 제외 포함)
- [ ] Playwright 8개 핵심 시나리오 그린
- [ ] **실제 next build 검증**(tsc만 아님 — React18 런타임)

## G. 게이트 & 릴리즈
- [ ] GATE 1 (error-registry, 300줄 규칙) / GATE 2 (본 문서 전항목) / GATE 3 (버전 일치) / GATE 4 (Builder≠Reviewer) / GATE 5 (파괴적 변경 승인)
- [ ] 🟥 DC-QA / 🟥 DC-SEC / 🟥 DC-REV PASS
- [ ] 버전 v0.7.185 동기화: 루트 package.json, apps/web/package.json, CLAUDE.md, AGENTS.md
- [ ] README 반영(온보딩 동작/재진입)

## H. 성공 지표 (출시 후 측정 — 🟦 DC-BIZ)
- 온보딩 완료율 ≥ 70%
- 첫 실제 업무등록까지(TTFA) 24h 내 ≥ 80%
- 7일 잔존(첫 주 일일등록 3일+) ≥ 50% — **북극성**
- 반증지표: 온보딩 직후 1회 입력 후 7일 무활동 비율(착시 방지)

---

### 현재 상태
**기획 단계 — 위 항목 전부 미구현(체크 0).** 사용자 지시("절대 구현하지마")에 따라 docs 5종만 산출. Phase 0 결정(A) 승인 시 구현 착수.
