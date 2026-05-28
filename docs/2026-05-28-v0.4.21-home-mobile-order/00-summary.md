# FAST PATH Summary
작업: 홈 페이지 모바일에서 '오늘 업무' 섹션을 캘린더 위(최상단)로 이동
대상: apps/web/app/(member)/home/page.tsx, apps/web/app/globals.css
이유: 모바일 사용자가 퀵 등록을 위해 스크롤 없이 바로 입력할 수 있도록 UX 개선
영향: 데스크탑/태블릿 레이아웃 무변경 (CSS order로 캘린더 좌측 유지)
