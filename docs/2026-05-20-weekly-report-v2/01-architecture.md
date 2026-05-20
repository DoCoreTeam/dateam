# Architecture — 주간보고 v2

## 파일 구조
apps/web/app/(member)/weekly-report/
├── page.tsx              # Server Component (데이터 페칭 + 탭 라우팅)
├── WeeklyReportForm.tsx  # Client Component (동적 폼)
├── TeamReportView.tsx    # Client Component (팀 전체 뷰)
├── actions.ts            # Server Actions (upsert)
└── constants.ts          # CATEGORIES

## 데이터 흐름
page.tsx (서버):
  - user.id, 8주 weekOptions, thisWeek 데이터 → WeeklyReportForm props
  - 과거 구분 목록 (distinct category) → datalist props
  - 팀 전체 데이터 (profiles join) → TeamReportView props

WeeklyReportForm (클라이언트):
  - rows: [{category, performance, plan, issues}] state
  - 행 추가/삭제
  - submit → Server Action

TeamReportView (클라이언트):
  - 주차 선택 state
  - 선택 주차 팀원 보고 표시
