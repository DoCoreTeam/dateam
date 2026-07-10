# FAST PATH Summary — v0.7.292

작업: 이력 탭(/work/activity)이 방금 만든 활동(주간 저장·신규 일일)을 안 보여주던 문제 수정 — SWR 1페이지 재검증 활성화.

대상: `apps/web/app/(member)/work/activity/page.tsx` (useSWRInfinite 옵션)

이유(실데이터 진단):
- 사용자가 주간보고 저장(create+edit 2건) + 신규 일일업무를 만들었고 **DB엔 전부 정상 기록**됨:
  - `weekly_report_activity` 3건(7/10 15:07~15:08 KST) + `weekly_report_snapshots` manual_save 3건
  - `audit_log` daily insert id25(AI자식, 이노그리드) 정상, id24(raw헤드) 제외 정상
- 그런데 이력 화면은 최신이 13:26(id17)에서 **정지** — 순수 audit_log 일일(id25)마저 안 뜸 → API가 아니라 **클라이언트가 최신 페이지를 재검증하지 않음**.
- 원인: `useSWRInfinite(..., { revalidateFirstPage: false })` — 1페이지(최신 항목 보관)를 focus/mount에도 재검증 안 함 → 탭 재진입해도 새 활동이 영원히 안 보임.

수정: `{ revalidateFirstPage: true, revalidateOnFocus: true, revalidateOnMount: true }` — 탭 재진입·포커스 시 최신 페이지 재검증 → 방금 만든 활동 즉시 표시.

영향: 표시 전용(SSOT·DB·쓰기경로 무관). "더 보기" 시 1페이지도 재검증되나 이력 피드는 신선도 우선이라 허용.

검증: tsc 0 · design 통과 · 766 테스트 무변경. 실데이터로 누락 활동이 모두 DB에 존재함을 확인(표시만 문제였음).
