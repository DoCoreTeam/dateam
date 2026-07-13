# 주간보고창 화면 깜빡임(Flicker) — 원인 분석 보고서

- 접수일: 2026-07-13
- 버전 기준: v0.7.292
- 성격: **분석 전용 (구현·수정 없음 — 사용자 지시 "절대 구현하지마")**
- 분석: 🟦 DC-ANA → CEO 코드 검증 확정

---

## 결론 (Root Cause — 확신도 95%)

`apps/web/app/(member)/weekly-report/DailyTaskSelector.tsx:50-54`
**useEffect 의존성 배열에 `tasks.length`와 `loading`이 함께 들어가면서, 일일보고가 없는 주차에서 무한 재요청(fetch) 루프가 발생한다.** 사이드패널이 "불러오는 중…" ↔ "일일업무 없음"을 초 단위로 왕복 렌더 → 화면 깜빡임.

```tsx
// DailyTaskSelector.tsx:50-54
useEffect(() => {
  if (isOpen && tasks.length === 0 && !loading) {
    fetchTasks()
  }
}, [isOpen, tasks.length, loading, fetchTasks])
```

### 왜 루프가 도는가
- `WeeklyReportForm.tsx:652` 에서 `variant="side"` 로 렌더 → `useState(isSide)` 로 `isOpen`이 **항상 true** (line 24).
- `fetchTasks`(line 32-48)는 성공 시 `setTasks(filtered)` + `setLoading(false)`.
- **주차에 `content` 있는 일일보고가 0건이면** `filtered.length === 0` → `tasks.length`는 계속 0.

| 렌더 | isOpen | tasks.length | loading | effect 조건 | 동작 |
|------|--------|--------------|---------|-------------|------|
| R0 | true | 0 | false | ✅ | fetchTasks → setLoading(true) |
| R1 | true | 0 | true | ❌(!loading) | 대기 (fetch 진행) |
| R2 | true | 0 | false | ✅ | **fetchTasks 재호출** (loading이 true→false로 바뀌어 effect 재실행) |
| R3 | true | 0 | true | ❌ | 대기 |
| … | | | | | R2↔R3 무한 반복 |

루프 주기는 네트워크 응답 속도에 비례. 응답이 빠를수록 초당 수 회 깜빡임.

### 재현 조건
- "내 보고" 탭(`page.tsx` activeTab==='mine') → 우측 사이드 `DailyTaskSelector` 렌더
- `/api/daily/week?start=<weekStart>` 결과 중 `content.trim()` 있는 항목이 **0개인 주차** 선택 시
- **일일보고를 1건 이상 작성한 주차에서는 깜빡임이 사라진다** → 이 사실이 원인 확정 근거 (tasks.length>0이면 R2에서 조건 실패 → 루프 없음)

---

## 후보(보조) 원인

### A. DeptReportPanel.tsx — router.refresh() 후 일회성 플래시 (확신도 62%)
- `DeptReportPanel.tsx:66,76` — `normalizeRows`가 내용 동일해도 새 배열 반환 → `normalizedInitial` 참조 교체 → useEffect가 `setRows/setDirty/setLocalStatus` 연속 실행.
- `router.refresh()`(line 95,109) 후 RSC 재실행으로 `initialBody` 새 인스턴스 전달.
- "조직 현황" 탭 "AI 취합"/"저장" 직후 **순간 깜빡(무한 아님)**.

### B. WeeklyReportForm.tsx — refine 타이머 (확신도 25%)
- `setInterval(500ms)`(line 131)로 `setRefineElapsed`. AI 다듬기 실행 중에만, `AXLoadingOverlay`만 갱신 → 전체 깜빡임 아님. cleanup 존재.

### C. actions.ts — revalidatePath 이중 재페치 가능성 (확신도 30%)
- 저장 후 `revalidatePath('/weekly-report')` + `router.push` 병행 → 불필요 재페치 가능성 (플래시 원인으로는 약함).

---

## 영향 범위
- 동일한 "isOpen + length + loading 3중 의존성" 안티패턴은 **다른 파일에 없음** — `DailyTaskSelector.tsx`가 유일한 실제 무한 루프 발원지.
- 유사 주의: `DeptReportPanel.tsx:76`(중간), `AutoDraftPanel.tsx:59`(낮음/현재 안전), `MemoIntakeList.tsx:40`(안전).

---

## 수정 방향 권고 (구현하지 않음 — 참고용)

> 사용자 지시에 따라 코드는 수정하지 않았다. 승인 시 아래 방향으로 진행 가능.

1. **주 원인 (DailyTaskSelector.tsx:50-54)**: 의존성에서 `tasks.length`·`loading` 제거 → `[isOpen, fetchTasks]`만 유지. `fetchTasks`가 `useCallback([weekStart])`로 안정적이라 주차 전환·패널 오픈 시에만 재페치되고, 빈 결과여도 루프 없음. 필요 시 `hasFetchedRef`로 side variant 중복 페치 추가 차단.
2. **보조 (DeptReportPanel.tsx:76)**: `initialBody` 내용 비교(또는 낙관적 업데이트로 `router.refresh()` 제거)로 불필요 재실행 억제.

검증 방법: 일일보고 0건 주차에서 사이드패널 무한 fetch가 멈추는지 네트워크 탭으로 확인 + 브라우저 실렌더에서 깜빡임 소멸 확인.
