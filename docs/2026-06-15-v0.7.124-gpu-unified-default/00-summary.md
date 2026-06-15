# v0.7.124 — GPU 관리 통합(unified) 뷰를 코드 기본값으로

## 작업 요약
GPU 관리 화면이 "옛날 탭 메뉴" 형식으로 보이던 문제 해결. 원인은 통합 리팩토링이
`unified` 피처 플래그 뒤에 있었고 기본값이 **OFF**였던 것(설계상 병존·무중단). 플래그
기본값을 **ON**으로 전환해, 별도 환경변수/localStorage 설정 없이도 통합뷰가 기본 화면이 됨.

## 수정 파일
- `apps/web/lib/gpu/feature-flags.ts`
  - `DEFAULT_ON` 맵 신설(SSOT) — `unified: true`
  - `resolveBase()` 도입 — 환경변수 `NEXT_PUBLIC_GPU_UNIFIED` 명시값('1'/'true'/'0'/'false') 우선,
    미설정이면 `DEFAULT_ON` 사용
  - 헤더 주석을 "기본 OFF" → "기본 ON·롤백 가능"으로 갱신
- 버전 4파일: 루트 `package.json`, `apps/web/package.json`, `CLAUDE.md`, `AGENTS.md`

## 변경 이유
리팩토링이 완료된 통합뷰가 매 브라우저마다 localStorage 오버라이드를 켜야만 보이는 상태였음.
사용자가 통합뷰를 정식 기본 화면으로 확정 요청 → 코드 기본값 전환.

## 영향 범위 / 롤백
- 영향: `isGpuFlagOn('unified')` 호출처(`GpuPricingClient.tsx`)가 기본 true → 'board' 탭이
  `UnifiedTableConnected` 렌더, 탭 목록은 intake+board로 축소. 기존 ON 동작과 동일(e2e로 검증된 경로).
- 계산/데이터 로직 무변경, 표시·진입만.
- **롤백 무비용**: `NEXT_PUBLIC_GPU_UNIFIED=0`(전역) 또는 `localStorage['gpu:flag:unified']='off'`(브라우저별)
  → 기존 10탭 즉시 복귀.

## 검증
- `tsc --noEmit` 0
- `pnpm design:check` 통과
- e2e `gpu-unified-table.spec.ts`(localStorage 'on' 가정)는 기본 ON에서도 그대로 통과
