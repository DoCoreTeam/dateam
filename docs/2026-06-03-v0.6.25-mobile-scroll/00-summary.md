# FAST PATH Summary — 모바일 세로 스크롤 수정
작업: 모바일에서 페이지 세로 스크롤 불가 → 가능하도록 레이아웃 CSS 수정
대상: apps/web/app/globals.css (.app-content min-height:0 / @media<768px .app-shell overflow·height)
이유: .app-shell{overflow:hidden;height:100dvh}가 전 뷰포트 공통 적용 + .app-content min-height:0 누락 →
      모바일(사이드바 fixed)에서 내부 스크롤 컨테이너 무력화로 스크롤 완전 차단(DC-ANA 규명).
변경: ① .app-content에 min-height:0 추가(flex 스크롤 체인) ② @media<768px에서 .app-shell을
      height:auto·min-height:100dvh·overflow:visible, .app-content overflow:visible로 → 문서 자연 스크롤.
영향: 데스크탑 미디어쿼리 밖이라 무영향(기존 내부 main 스크롤 유지). 회귀 낮음.
