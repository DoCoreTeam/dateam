# FAST PATH Summary
작업: 사이드바 통합입력(highlight)과 메뉴 active 표시 시각 구분
대상: apps/web/components/ui/MobileShell.tsx (데스크탑 nav 렌더)
이유: 현재 테마에서 --accent==--brand==#6366f1 동색 → 둘 다 "인디고 채운 박스"로 보여 혼동
영향: 통합입력=솔리드 채움 CTA 유지 / active=채움 제거→투명+보더+좌측 인디고 바(inset)+볼드 아웃라인. aria-current 유지, 레이아웃 시프트 없음. 모바일 드로어는 통합입력 미렌더(별도 플로팅)라 충돌 없음→미변경
