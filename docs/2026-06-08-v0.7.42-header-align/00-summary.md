# FAST PATH Summary
작업: 사이드바 브랜드(로고+버전) 블록 하단 보더선을 상단 헤더(인사) 하단선과 정렬
대상: apps/web/components/ui/MobileShell.tsx (브랜드 div)
이유: 브랜드 블록 상하 padding(1.25rem≈76px)이 헤더 height(56px)보다 커서 하단 보더선 불일치
변경: 브랜드 div → height 56px + 수직중앙 + 좌우 padding만 → 헤더와 동일 높이로 하단선 정렬
영향: 전 화면 사이드바(자동) · 전 테마 공통(구조 변경, 토큰 무관)
