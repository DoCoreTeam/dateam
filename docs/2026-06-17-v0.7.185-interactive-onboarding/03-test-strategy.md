# 03 · 테스트 전략 — 실습형 인터랙티브 온보딩

> v0.7.185 기획 · 프로젝트 테스트 = node:test 러너(파일목록 수동관리, apps/web/package.json) + Playwright(repo root config). 새 `*.test.ts`는 **package.json test 목록에 추가해야 실행됨.**

## 1. 단위 테스트 (node --test)

| 대상 | 케이스 |
|---|---|
| `lib/onboarding/steps.ts` | 스텝 시퀀스 순서/키 유일성/라우트 매핑 정합 |
| `lib/onboarding/useTour.ts` | 게이팅(행동 전 진행 불가), `moveNext()` 외부호출, reduced-motion 시 `animate:false`, 동적 import 분기 |
| `lib/onboarding/onboarding-state.ts` | URL `?onboard=` ↔ 스텝 키 변환, 완료/스킵 상태 전이, 잘못된 stepKey 폴백 |
| 집계 제외 로직 | `is_onboarding=true` 행이 롤업/AI 후보 입력에서 필터링되는지(순수 함수 단위) |

- 새 테스트 파일은 **apps/web/package.json `test` 스크립트 목록에 명시적 추가**(자동 포함 안 됨).

## 2. 통합 테스트 (DB/RLS)

- 마이그레이션 113 적용 후 스키마 검증: 컬럼 존재, 기본값, 기존 행 무변경(`onboarding_completed_at` NULL 유지).
- RLS: 타 사용자의 onboarding 상태/온보딩 daily_log 조회·수정 불가.
- `is_onboarding` 더미 등록 → 주간보고 롤업 쿼리·AI 후보추출에서 **제외 확인**(오염 방지 핵심 테스트, `[[feedback_test_isolation]]`).
- 테스트는 throwaway 계정/`is_test` 행으로(운영 실데이터 오염 금지).

## 3. E2E (Playwright — apps/web/e2e, 우선순위 1)

| 시나리오 | 검증 |
|---|---|
| **최초 로그인 자동 시작** | 신규 member 로그인→/home 착지→온보딩 자동 스포트라이트 노출 |
| **모달 우선순위** | must_change_password/이름미설정 계정은 그 모달 먼저→완료 후 온보딩 |
| **일일 등록 실습(P0)** | textarea 입력→등록→실제 daily_log 생성(is_onboarding=true)→다음 스텝 자동 진행 |
| **멀티페이지 재개** | /daily→/org→(P2)/pricing 라우트 전환 후 정확한 스텝 재개(URL `?onboard=`) |
| **진행 영속화** | 중간 로그아웃→재로그인→DB onboarding_step 기준 이어서 |
| **스킵→재진입** | 스킵 시 종료·재노출 안 함→사이드바 "다시 하기"로 재시작 |
| **완료** | 마지막 스텝→onboarding_completed_at 기록→재로그인 시 미노출 |
| **GPU 실제 렌더(P2)** | `?tab=cockpit`에서 UnifiedTableConnected/PriceCockpitTab 앵커에 스포트라이트(구 PriceTableTab 아님) |

- 결정적 대기 사용(타임아웃 기반 flaky 금지). driver 오버레이/popover는 `.driver-popover.ax-onboard`로 셀렉트.

## 4. 시각·반응형 회귀 (web testing 규칙)

- 스크린샷 브레이크포인트 **320/768/1024/1440** + 라이트/다크 양 테마.
- 모바일 카드 레이아웃에서 스포트라이트 cutout 좌표 정확성(타겟 벗어남/잘림 없음).
- 모바일 폴백(중앙 모달) 동작.

## 5. 접근성

- 키보드만으로 진행/스킵, ESC 동작(실습 강제 구간 정책 일치).
- `prefers-reduced-motion: reduce` → 애니메이션 off.
- 포커스 복원(driver.js 내장) 확인, popover 색대비 4.5:1.

## 6. 게이트 (커밋/PR 전)

- `cd apps/web && pnpm exec tsc --noEmit` (실제 next build 권장 — `[[feedback_react18_build_verify]]`: tsc만으로 React API 런타임 미검출).
- `pnpm design:check` (토큰 가드) + 폼/모달 표준 클래스 **눈으로 대조**(가드 사각지대).
- `pnpm exec playwright test` 핵심 시나리오 그린.

## 7. 커버리지 목표

- 신규 `lib/onboarding/*` 단위 80%+.
- E2E는 위 8개 핵심 흐름 필수. 시각 회귀는 보조(커버리지 대체 아님).
