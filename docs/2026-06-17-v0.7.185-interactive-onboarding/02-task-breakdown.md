# 02 · 태스크 분해 — 실습형 인터랙티브 온보딩

> v0.7.185 기획 · 구현 착수 시 이 순서로. 각 태스크에 담당 에이전트·검증 명시.

## Phase 0 — 사전 결정 (구현 전 사용자 승인 필요)
- [ ] **D-1 실데이터 격리 확정**: "진짜 등록 + `is_onboarding` 격리"안 승인 (vs 비저장 샌드박스). → 00-6 / 01-3-2
- [ ] **D-2 기존 사용자 노출 정책**: 마이그레이션 113에서 기존 member를 completed 백필할지(노출 X) vs 전원 1회 노출. → 01-3-1
- [ ] **D-3 driver.js 설치 승인**: `pnpm add driver.js`(루트/apps/web). 번들 예산 확인.
- [ ] **D-4 범위 확정**: P0(일일+조직)만 강제 / P1(AI)·P2(GPU) 선택형 — 합의.

## Phase 1 — DB 기반 (🟩 DC-DEV-DB)
- [ ] T-1 `supabase/migrations/113_onboarding.sql` 작성
  - profiles: `onboarding_completed_at`, `onboarding_step`, `onboarding_skipped_at` (ADD only)
  - daily_logs + 부서업무 테이블: `is_onboarding BOOLEAN NOT NULL DEFAULT FALSE`
  - 백필 정책(D-2 결과 반영), RLS 영향 점검
  - 검증: `migrate.sh --status`, 롤백 가능성, 기존 행 무변경
- [ ] T-2 집계 제외 반영: 주간보고 롤업·AI 후보추출 쿼리에 `is_onboarding=false` 필터 추가 지점 식별·수정
  - 검증: 온보딩 더미가 롤업/AI 후보에 안 나오는 통합 테스트

## Phase 2 — 온보딩 엔진 SSOT (🟩 DC-DEV-FE)
- [ ] T-3 `lib/onboarding/steps.ts` — 라우트별 스텝 시퀀스/카피/앵커/완료신호 정의(데이터만)
- [ ] T-4 `lib/onboarding/useTour.ts` — driver.js 래핑 훅(SSOT)
  - 동적 import, `disableActiveInteraction:false`, `allowClose:false`, reduced-motion, `popoverClass:"ax-onboard"`, `moveNext()` 외부호출 API 노출
  - 검증: 단위 테스트(스텝 전환, 게이팅, reduced-motion 분기)
- [ ] T-5 `lib/onboarding/onboarding-state.ts` + `api/onboarding`(route handler or server action)
  - 진행/완료/스킵 DB 영속화, URL `?onboard=` 동기화 헬퍼
  - 검증: 진행 저장→재로그인 재개, 스킵 후 미노출

## Phase 3 — 트리거 & 마운트 (🟩 DC-DEV-FE)
- [ ] T-6 `components/onboarding/OnboardingProvider.tsx` — 자동 트리거(미완료 판정), 재진입 CustomEvent 수신
- [ ] T-7 `app/(member)/layout.tsx` 수정 — `must_change_password`/이름설정 **우선** 처리 후 OnboardingProvider 조건부 마운트(line 128~130 옆)
  - 검증: 모달 우선순위 충돌 없음(비번변경→이름→온보딩 순)
- [ ] T-8 재진입 진입점 — 사이드바/도움말 "온보딩 다시 하기"(기존 weekly `OnboardingRestartLink` 흡수)

## Phase 4 — 화면별 실습 연결 (🟩 DC-DEV-FE)
- [ ] T-9 [P0] `/home` 환영·사이드바 스텝(중앙 모달 + 사이드바 앵커)
- [ ] T-10 [P0] `/daily` 일일 등록 실습 — `<textarea>`/등록버튼 앵커 + 등록 성공(`mutate()` 272) 시 `is_onboarding=true`로 저장 + `moveNext()`
  - 검증: 실제 등록되되 롤업/AI 제외, 다음 스텝 자동 진행
- [ ] T-11 [P0] `/org` 조직·내 위치 둘러보기 스텝
- [ ] T-12 [P2] `/pricing/gpu?tab=cockpit` — **UnifiedTableConnected/PriceCockpitTab**에 앵커, 금액 확인 스텝(조건부 노출)
- [ ] T-13 [P1] AI 체험 — daily AI저장 또는 `DeptTaskSuggestPanel` onRegistered 연결("나중에" 선택형)

## Phase 5 — 디자인·접근성 (🟩 DC-DEV-FE + 🟨 DC-TOK 토큰)
- [ ] T-14 `globals.css` — `--z-onboarding` 토큰 + `.driver-popover.ax-onboard` 테마(토큰 경유, 다크/라이트), 인라인 style 금지
- [ ] T-15 반응형 실측(320/768/1024/1440) — 모바일 카드 레이아웃 cutout 좌표, 모바일 폴백
- [ ] T-16 a11y — 키보드/ESC/포커스 복원/reduced-motion/색대비, `pnpm design:check` 통과

## Phase 6 — 기존 자산 통합 정리 (🟩 DC-DEV-FE)
- [ ] T-17 주간보고 `SpotlightOnboarding` → 신규 엔진 스텝으로 이전 후 구 컴포넌트 제거(SSOT, 공존 금지)
  - 검증: 주간보고 온보딩 동작 동일·회귀 없음

## Phase 7 — 평가·게이트 (🟥 DC-QA / 🟥 DC-SEC / 🟥 DC-REV)
- [ ] T-18 🟥 DC-QA E2E(Playwright): 최초로그인→실습완료, 스킵→재진입, 멀티페이지 재개
- [ ] T-19 🟥 DC-SEC: 진행/완료 API 권한(본인만), RLS, is_onboarding 우회 불가
- [ ] T-20 🟥 DC-REV: SSOT 준수, 실제 렌더 경로 수정 확인, 디자인 토큰, 300줄 규칙
- [ ] T-21 GATE 1-5 + 04-completion-criteria 전 항목 ✅ + 버전 v0.7.185 동기화(package.json×2, CLAUDE.md, AGENTS.md)

## 병렬 가능
- Phase 1(DB)과 Phase 2(엔진 데이터/훅 골격) 병렬.
- Phase 4 화면별 태스크(T-9~13)는 엔진(Phase 2) 완료 후 상호 독립 → 병렬.
