# 01 · 아키텍처 — 실습형 인터랙티브 온보딩

> v0.7.185 기획 · 기획 문서(코드 구현 없음). 모든 파일경로/라인은 🟦 DC-ANA 실조사 기준.

## 1. 전체 구조 (한 장)

```
로그인 성공 → /dashboard(패스스루) → /home
        │
        ▼
(member)/layout.tsx (서버)  ── profiles.onboarding_completed_at 조회
        │  must_change_password? → PasswordChangeModal (우선)
        │  !name?               → NameSetupModal     (우선)
        │  onboarding 미완료?    → <OnboardingProvider> 마운트  ← 신규 삽입점(line 128~130 옆)
        ▼
<OnboardingProvider> (client, "use client")
        │  - lib/onboarding/useTour.ts (driver.js SSOT 훅)  ← 신규
        │  - lib/onboarding/steps.ts   (스텝 정의 SSOT)     ← 신규
        │  - 진행상태: URL ?onboard=<stepKey> + DB 동기화
        ▼
페이지별 미니투어 (driver.js 인스턴스를 페이지마다 생성)
   /home    → 환영 + 사이드바 안내
   /daily   → [실습] 일일 업무 직접 등록 (is_onboarding=true)
   /org     → 조직/내 위치 둘러보기
   /pricing → [실습·조건부] GPU 금액 확인
   (P1) AI  → AI 결과 1회 체험
        ▼
완료 → profiles.onboarding_completed_at = now() → 축하 화면
```

## 2. 엔진 결정 — driver.js (신규 SSOT) + 기존 SpotlightOnboarding 흡수

| 항목 | 결정 |
|---|---|
| 라이브러리 | **driver.js v1.4.0** (MIT, 6KB, deps 0) — 🟦 DC-OSS/RES 확정 |
| 기존 자산 | `components/ui/SpotlightOnboarding.tsx`(주간보고, box-shadow cutout, localStorage)는 **driver.js 기반으로 교체·흡수**. 스포트라이트 구현 2벌 공존 금지(SSOT). |
| 신규 SSOT | `lib/onboarding/useTour.ts`(엔진 훅) + `lib/onboarding/steps.ts`(스텝 데이터). 모든 화면이 import. |
| 마이그레이션 경로 | 주간보고 온보딩의 5스텝을 `steps.ts`의 한 시퀀스로 이전 → 기존 컴포넌트 제거(별도 정리 PR 권장). |

### driver.js 핵심 옵션 (🟦 DC-RES 검증, v1.4.0 정확 옵션명)
- 강조요소 클릭/입력 허용: **`disableActiveInteraction: false`(기본값)** — 별도 설정 불필요. ⚠️ 구버전 `allowInteraction`은 v1에 없음.
- 실습 게이팅: 스텝 `showButtons: []`로 Next 숨김 → 실제 행동 성공 콜백에서 **`driverObj.moveNext()`** 호출. 또는 `onNextClick`에서 검증 통과 시에만 `moveNext()`.
- 사고 종료 방지: `allowClose: false` + `overlayClickBehavior` 커스텀(딤 클릭으로 종료 금지). 스킵은 명시적 X 버튼/onPopoverRender 커스텀 버튼으로만.
- 키보드 우회 차단: `allowKeyboardControl: false`(실습 강제 구간).
- SSR: **`"use client"` + `useEffect` 내부**에서만 `driver()` 생성, `const { driver } = await import("driver.js")` 동적 import 권장.
- reduced-motion: 자동대응 없음 → `matchMedia('(prefers-reduced-motion: reduce)')` 감지해 `animate:false`.

## 3. 데이터 모델 (DB)

### 3-1. 진행 상태 — `profiles` 확장 (마이그레이션 **113**, 다음 번호 확정)
```
-- ADD only (롤백 가능, 기존 행 보호 — must_change_password 패턴 복제)
ALTER TABLE profiles
  ADD COLUMN onboarding_completed_at TIMESTAMPTZ,   -- NULL=미완료
  ADD COLUMN onboarding_step TEXT,                  -- 마지막 도달 스텝 key (재개용)
  ADD COLUMN onboarding_skipped_at TIMESTAMPTZ;     -- 스킵 시각(완료와 구분)
```
- `NULL` = 미완료 → 자동 트리거. boolean 대신 timestamptz로 **TTFA/완료율 분석** 가능.
- ⚠️ `[[feedback_existing_data_protection]]`: 기존 행에 값 강제 주입 금지(전부 NULL 유지 = 기존 사용자도 1회 노출). 기존 사용자 노출 원치 않으면 **백필 정책을 마이그레이션에 명시**(예: 가입 N일 경과 계정은 completed 처리) — 결정 필요.

### 3-2. 실데이터 격리 — `is_onboarding` 플래그 (오염 방지, §00-6)
```
ALTER TABLE daily_logs   ADD COLUMN is_onboarding BOOLEAN NOT NULL DEFAULT FALSE;
-- 부서업무 테이블도 동일 (dept_tasks 류, 실제 테이블명 구현 시 확인)
```
- 집계/조회 제외: 주간보고 롤업, AI 후보추출(`lib/gemini-suggest-tasks.ts` 등), 리스트 기본 뷰에서 `WHERE is_onboarding = false` 필터.
- RLS: 본인 행만(기존 daily_logs RLS 그대로), 추가 컬럼이 정책에 영향 없는지 점검.
- 정리: 사용자가 "연습분 지우기" 또는 온보딩 완료 시 자동 soft-delete 옵션(결정 필요).

## 4. 진행 상태 동기화 (URL + DB)

- 프로젝트 컨벤션(URL state)에 맞춰 **`?onboard=<stepKey>`** 를 단일 진실의 위치로.
- 페이지 전환: 현재 스텝 `onNextClick`에서 `router.push('/daily?onboard=daily-create')` → 다음 페이지 마운트 시 쿼리 읽어 해당 미니투어 `drive(0)`.
- DB write: 스텝 전환마다 또는 디바운스로 `onboarding_step` 갱신(서버 액션/route handler). 깜빡임 방지용 localStorage 캐시는 **보조**(진실은 DB).
- 비동기 렌더 타겟: `element: () => document.querySelector('#onboarding-...')` 함수형 + 등장 보장(MutationObserver/rAF).

## 5. 화면별 DOM 앵커 (실제 렌더 경로 — 🟦 DC-ANA)

| 스텝 | 라우트 | 실제 컴포넌트 | 앵커(신규 `id`/기존) | 완료 신호 |
|---|---|---|---|---|
| 환영 | `/home` | `(member)/layout.tsx`+MobileShell | element 없는 중앙 모달 | Next |
| 사이드바 | `/home` | `MobileShell`/`SidebarProfile` | 사이드바 메뉴 영역 | Next |
| **일일 등록** | `/daily` | `daily/page.tsx`(인라인 폼) | `<textarea>`(page.tsx:634) + 등록 버튼 | submit 성공 후 `mutate()`(page.tsx:272) 훅 → `moveNext()` |
| 조직 | `/org` | `org/page.tsx`→`OrgPublicTree` | 트리 루트 | Next |
| **GPU 확인**(P2) | `/pricing/gpu?tab=cockpit` | **`UnifiedTableConnected`**(unified flag DEFAULT_ON=true) / 콕핏 `PriceCockpitTab` | `.gpu-topbar`, `.gpu-pricing-root`, `data-testid="ai-panel-toggle"` | 특정 GPU 행 확인/클릭 |
| AI 체험(P1) | `/daily` or `/dept-tasks` | daily AI저장 / `DeptTaskSuggestPanel`(onRegistered) | AI 버튼 | AI 결과 표시/콜백 |

> ⚠️ **실제 렌더 경로 정책 준수**: GPU는 구 `PriceTableTab` 아님 — 반드시 `UnifiedTableConnected` 내부에 앵커. 앵커 `id`는 신규 부여하되 **표시/레이아웃 무변경**(읽기 전용 hook point).

## 6. z-index — 토큰 신설 (하드코딩 제거)

기존 `SpotlightOnboarding`은 9998/9999/10000 **하드코딩**(globals.css 토큰 미사용). driver.js 통합 시:
```
/* globals.css :root — 신규 토큰 */
--z-onboarding: 1100;   /* --z-toast:300 보다 위, driver 내부 레이어 기준 정렬 */
```
- driver.js popover/overlay에 `popoverClass="ax-onboard"` 부여 후 globals.css에서 토큰 기반 테마(배경 `--surface-bg`, 텍스트 `--text`, radius `--radius-lg`, shadow `--shadow-lg`, 버튼 `--brand`). 다크/라이트 자동 대응.

## 7. 파일 구조 (신규/수정 — 구현 시)

```
신규:
  lib/onboarding/useTour.ts          # driver.js 래핑 훅 (SSOT, "use client")
  lib/onboarding/steps.ts            # 스텝 정의(라우트별 시퀀스, 카피, 앵커)
  lib/onboarding/onboarding-state.ts # DB 동기화(서버액션/fetch) + 완료/스킵
  components/onboarding/OnboardingProvider.tsx  # 마운트·자동트리거·재진입 이벤트
  components/onboarding/OnboardingRestartLink.tsx # 재진입(기존 weekly용 흡수)
  app/(member)/api/onboarding/route.ts (또는 server action) # 진행/완료 영속화
  supabase/migrations/113_onboarding.sql  # profiles 컬럼 + is_onboarding 컬럼
수정:
  app/(member)/layout.tsx            # OnboardingProvider 조건부 마운트(line 128~)
  app/globals.css                    # --z-onboarding 토큰 + .driver-popover.ax-onboard 테마
  app/(member)/daily/page.tsx        # 등록 성공 콜백에 온보딩 moveNext 훅(앵커 id)
  app/(member)/dept-tasks/*          # onSaved 훅 + 앵커
  pricing GPU UnifiedTableConnected  # 앵커 id (읽기전용)
  (이전) weekly-report SpotlightOnboarding → 신규 엔진으로 교체 후 제거
```

## 8. 위험 & 완화

| 위험 | 완화 |
|---|---|
| 실데이터 오염 | `is_onboarding` 격리 + 집계 제외(§3-2) |
| 모바일 좌표 깨짐 | 카드 레이아웃 브레이크포인트 실측, 모바일은 element 없는 중앙 모달로 폴백 가능 |
| 멀티페이지 상태 유실 | URL `?onboard=` + DB가 진실, 페이지별 인스턴스 |
| 스포트라이트 2벌 공존 | 기존 SpotlightOnboarding 흡수(FR-8) |
| 기존 사용자 일괄 노출 | 113 마이그레이션 백필 정책 명시(결정 필요) |
| 강제 모달 → Skip 학습 | P0만 강제, 즉시 스킵+재진입 보장 |
