# FAST PATH Summary — 주간보고창 깜빡임 버그픽스

- 버전: v0.7.293 (PATCH)
- 성격: 버그픽스 (무한 리렌더 루프 제거)

작업: `DailyTaskSelector`의 useEffect 무한 재요청 루프 제거 → 주간보고창 깜빡임 해결
대상: `apps/web/app/(member)/weekly-report/DailyTaskSelector.tsx` (useEffect, 기존 50-54)
이유:
- 기존 deps `[isOpen, tasks.length, loading, fetchTasks]` 구조에서, 일일보고가 없는 주차(빈 결과)면
  `tasks.length`가 계속 0이고 `loading`이 true→false로 토글되며 effect가 재실행 → 조건
  `isOpen && 0===0 && !false`가 계속 참 → `fetchTasks()` 무한 재호출 → "불러오는 중…" ↔ "일일업무 없음"
  교차 렌더 = 화면 깜빡임.
- side variant(`WeeklyReportForm.tsx:652`)는 `isOpen`이 항상 true라 마운트 즉시 루프 진입.

수정:
```tsx
// before
useEffect(() => {
  if (isOpen && tasks.length === 0 && !loading) { fetchTasks() }
}, [isOpen, tasks.length, loading, fetchTasks])

// after — ref 가드로 weekStart별 1회만 페치 (tasks.length/loading을 deps에서 제거)
const fetchedWeekRef = useRef<string | null>(null)
useEffect(() => {
  if (isOpen && fetchedWeekRef.current !== weekStart) {
    fetchedWeekRef.current = weekStart
    fetchTasks()
  }
}, [isOpen, weekStart, fetchTasks])
```

동작 보존:
- 주차 변경 시 재페치(ref !== weekStart) ✅
- 패널 오픈 시 최초 1회 페치 ✅
- 빈 결과 주차에서도 루프 없음(ref가 deps에 없고, loading/tasks.length가 트리거에서 제거됨) ✅
- 재오픈 시 선택상태 보존(원래 의도 유지) ✅

영향: `WeeklyReportForm.tsx`(렌더처) 수정 불요 — 동작만 확인. 다른 화면 파급 없음(전 화면 감사에서 유일 루프로 확정됨).

검증: `pnpm exec tsc --noEmit` 통과(exit 0). 🟥 DC-REV 리뷰 통과.
