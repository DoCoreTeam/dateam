# FAST PATH Summary — v0.4.9

작업: 일일업무·캘린더 로딩 지연 원인 진단 및 unbounded query limit 추가
대상: `apps/web/app/(member)/daily/actions.ts`
이유: v0.3.9 성능 튜닝이 daily_logs/calendar를 누락했고, getMonthLogSummary·getCarryoverLogs에 limit()이 없어 데이터 증가 시 무제한 스캔 발생
영향: `calendar/page.tsx` (getMonthLogSummary 호출), `daily/page.tsx` (getCarryoverLogs 호출)

## 원인 분석

### v0.3.9 튜닝 범위 (포함된 항목)
- profiles, ai_token_logs, weekly_reports DB 인덱스
- accounts / contacts / deals cursor 페이지네이션 + SWR 캐싱

### 누락된 항목 (daily/calendar)
- DB 인덱스: 기존 migration 010/013에서 이미 적절한 인덱스 존재 (문제 아님)
- **진짜 문제**: accounts/contacts/deals는 SWR + REST API로 캐시 활용하지만
  daily/calendar는 useEffect + Server Actions 직접 호출 → 매 방문마다 재요청 waterfall

### 즉시 수정 가능한 부분 (이번 패치)
- `getMonthLogSummary`: limit 없이 한 달치 전체 조회 → `.limit(500)` 추가
- `getCarryoverLogs`: limit 없이 조회 → `.limit(30)` 추가

### 근본 해결 (별도 MEDIUM 태스크 권장)
- daily/calendar를 SWR + API route 패턴으로 전환
- 또는 Server Component로 전환하여 SSR에서 데이터 포함
