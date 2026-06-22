# FAST PATH Summary — v0.7.242

## 작업
주간보고 작성 화면에서 [저장] 시 페이지가 맨 위로 튀던 문제 수정 → 현재 스크롤/포커스 유지 + 뷰포트 우하단 토스트 알림.

## 대상 (수정 파일)
- `apps/web/components/ui/QueryToast.tsx` (신규) — 쿼리스트링(`?param=1`) 감지 → 뷰포트 고정 토스트 → 자동소멸 + URL에서 해당 키만 `router.replace(scroll:false)`로 제거. 프로젝트 최초 공용 토스트(SSOT).
- `apps/web/app/(member)/weekly-report/page.tsx` — 최상단 `justSaved`/`justReset` 배너 div 2개 → `<Suspense><QueryToast param="saved"/><QueryToast param="reset"/></Suspense>`. 미사용된 `saved`/`justSaved` 제거(`reset`/`justReset`은 form key에 계속 사용).
- `apps/web/app/(member)/weekly-report/WeeklyReportForm.tsx` — 저장(290)·초기화(211) 후 `router.push(dest)` → `router.push(dest, { scroll: false })`.

## 이유
저장 성공 후 `router.push()`가 Next.js App Router 기본값 `scroll:true`라 매 네비게이션마다 스크롤 컨테이너(`<main>`)를 맨 위로 리셋. 게다가 피드백이 최상단 배너라 "위로 올라가야만 보이는" 구조였음. → `scroll:false`로 위치 보존 + 뷰포트 토스트로 위치 무관하게 알림.

## 영향
- 연관: `reset=1`(초기화) 배너도 같은 패턴이라 함께 토스트로 통일(UX 갈라짐 방지).
- `QueryToast`는 공용 컴포넌트 → 추후 일일/부서 등 타 저장 화면에서 재사용 가능.
- `revalidatePath`(actions.ts)는 그대로라 데이터 갱신 영향 없음(스크롤만 고정).
- 회귀 리스크 낮음: 같은 주차 저장 시 form `key` 불변 → 입력 상태 보존.

## 검증
- typecheck(tsc) ✅ / lint ✅(신규 경고 없음) / `pnpm design:check` ✅(hex 0, 신규 ratchet 0)
- Playwright 로컬 실측(throwaway 계정): 저장 전후 `main.scrollTop = 647` 동일(맨 위 0으로 안 튐) ✅, 토스트 `position:fixed · bottom/right 24px · z-300 · success green · "주간보고가 저장되었습니다" · opacity 0.965 페이드인` ✅, 자동소멸 후 URL에서 `saved=1` 제거 ✅. 테스트 계정·데이터 정리 완료.
