# FAST PATH Summary

작업: 사이드바 캘린더 메뉴에 오늘 planned 항목 수 배지 추가, 방문 시 소멸
대상: apps/web/app/(member)/daily/actions.ts, layout.tsx, calendar/page.tsx
이유: 루틴 체크와 동일한 패턴으로 오늘 할 일(planned) 미확인 시 배지 표시
영향: MobileShell badge prop은 이미 지원됨 — 수정 불필요

## 동작 원리
1. layout.tsx (server): cookie `calendar_seen_date` !== today → DB COUNT(planned) → 배지 표시
2. calendar/page.tsx (client): 페이지 마운트 시 `calendar_seen_date=today` cookie 설정
3. 다른 페이지 이동 후 → layout 재렌더 → cookie 확인 → badge = 0
