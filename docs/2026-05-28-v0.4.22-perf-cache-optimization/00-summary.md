# v0.4.22 — 캘린더·일일업무 로딩 속도 최적화

## 작업
캐시 전략 도입 + DayDetailPanel SWR화 + 동적 임포트로 체감 로딩 속도 개선

## 수정 파일
- `apps/web/app/api/calendar/month/route.ts` — Cache-Control no-store → 30초 캐시
- `apps/web/app/api/daily/logs/route.ts` — Cache-Control no-store → 30초 캐시
- `apps/web/app/api/daily/carryover/route.ts` — Cache-Control no-store → 30초 캐시
- `apps/web/app/(member)/layout.tsx` — getBranding unstable_cache TTL 1시간
- `apps/web/app/(member)/calendar/DayDetailPanel.tsx` — useEffect+Server Action → SWR
- `apps/web/app/(member)/daily/page.tsx` — KnowledgeGraphView, LogFlowView 동적 임포트

## 이유
DC-ANA 분석 결과: Cache-Control no-store 전면 적용으로 매 요청마다 전체 RTT 소비,
DayDetailPanel 마운트 후 uncached Server Action 직호출로 클릭 반응 지연

## 영향 범위
- 캘린더 월간 뷰 데이터: 30초 stale-while-revalidate (실시간성 ±30초)
- 일간 로그: 30초 캐시 (최신 입력이 최대 30초 지연 가능 → SWR mutate로 즉시 갱신)
- getBranding: 1시간 캐시 (조직 이름/로고 변경 반영 최대 1시간 지연)
- DayDetailPanel: 같은 날짜 재클릭 시 즉시 표시 (SWR dedupingInterval 5초)
