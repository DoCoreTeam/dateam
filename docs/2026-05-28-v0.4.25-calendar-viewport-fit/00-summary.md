# FAST PATH Summary
작업: 캘린더 월간 뷰 viewport fit + 오늘 날짜 항목 자동 표시
대상: apps/web/app/globals.css, apps/web/app/(member)/calendar/page.tsx

## 변경 내용
1. **page.tsx**: root `<div className="page-inner">` → `<div>` (MobileShell의 page-inner와 이중 패딩 64px 제거)
2. **globals.css**: `.calendar-day-cell` min-height
   - Before: `clamp(5.75rem, 9vw, 7.75rem)` — 와이드 모니터에서 최대 124px 고정
   - After: `max(4rem, min(7.75rem, calc((100dvh - 380px) / 6)))` — viewport 크기에 따라 동적 조정
3. **page.tsx**: `selectedDate` 초기값 `null` → `todayStr` — 페이지 진입 시 오늘 날짜 항목 자동 표시

## 이유
- 이중 패딩으로 64px 낭비, 셀 높이 고정으로 6행 * 124px + 헤더 = viewport 초과
- 오버헤드 상수 380px: 헤더(56px) + nav(48px) + weekday row(32px) + 범례(40px) + 패딩/여백(~204px)
- 초기 selectedDate를 today로 설정하여 오늘 일정을 DayDetailPanel에서 즉시 확인 가능

## 영향
- 캘린더 페이지 레이아웃만 변경. 다른 페이지 영향 없음.
