# 아키텍처 — 반응형 구현

## 레이어 구조
1. globals.css: 반응형 유틸 클래스 + 미디어쿼리 (단일 소스)
2. Sidebar.tsx: 모바일 드로어 + 햄버거 버튼 (클라이언트 상태)
3. layout.tsx (member/admin): 모바일 헤더 통합
4. page.tsx들: className 추가만으로 반응형 그리드/스택 적용

## Sidebar 모바일 패턴
- 데스크탑: 기존 fixed-width 사이드바
- 모바일: display:none → 햄버거 클릭 시 overlay drawer
- overlay: fixed position, z-index 50, 배경 dimmer

## globals.css 유틸 클래스
- .responsive-grid-2: desktop 2col / mobile 1col
- .responsive-grid-3: desktop 3col / mobile 1col
- .mobile-hidden: 768px 이하 숨김
- .mobile-only: 768px 이상 숨김
- .page-container: 모바일 패딩 조정
- .responsive-table: 모바일 가로 스크롤
