# FAST PATH Summary — 홈 레이아웃 재구성
작업: 미션&OKR 제거 → 오늘업무·확인안한메모·주간보고 횡 3컬럼 + 캘린더 하단, 스크롤 없이 한 화면
대상: app/(member)/home/page.tsx, app/(member)/home/HomeMiniCalendar.tsx, app/globals.css
이유: 사용자 요청 — 미션 제거, 3위젯 횡배치, 모바일 세로 순서(오늘업무→메모→주간보고→캘린더), 한 페이지에 다 보이게
영향: 미션 fetch/변수 제거(orgMap/missions/okrList), 캘린더 중복 "오늘 업무 미리보기" 제거 + 셀 32px 축소. 위젯 내부 로직 무변경
