# FAST PATH Summary — v0.4.27

작업: 일일업무 일정 날짜 수정 후 캘린더 즉시 반영
대상: daily/page.tsx, daily/actions.ts, calendar/page.tsx, api/calendar/month/route.ts, api/daily/week/route.ts
이유: `target_date` 변경 후 일일업무 화면은 즉시 갱신되지만 캘린더 월간 요약은 SWR/HTTP 캐시 때문에 일정 시간 뒤에 반영됨
영향: 일일업무 수정 저장, 캘린더 월간/주간 표시

## 수정 내용

| # | 문제 | 수정 |
|---|------|------|
| 1 | 저장 후 `/api/daily/logs`만 갱신되어 캘린더 월간 캐시가 stale 상태로 남음 | 저장 성공 시 daily logs, daily week, calendar month SWR 키를 함께 재검증 |
| 2 | 캘린더 월간 API가 `max-age=30`이라 즉시 재요청해도 캐시 응답 가능 | `/api/calendar/month` 응답을 `Cache-Control: no-store`로 변경 |
| 3 | 캘린더 주간 API가 `log_date`만 조회해 `target_date` 기준 일정이 빠질 수 있음 | `/api/daily/week` 조회 조건을 `log_date OR target_date` 범위로 확장 |
| 4 | 주간 캘린더 표시가 `log_date` 버킷만 사용 | 주간 날짜 맵에 `target_date`도 표시 날짜로 반영 |
| 5 | 서버 액션 revalidate 범위가 `/daily`에만 한정 | 일일업무 변경 액션에서 `/daily`와 `/calendar`를 함께 revalidate |
