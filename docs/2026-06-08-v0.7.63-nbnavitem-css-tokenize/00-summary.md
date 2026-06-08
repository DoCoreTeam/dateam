# FAST PATH Summary
작업: NbNavItem 인라인 style → .nb-nav-item[data-state] CSS 이전 + hover --nav-hover-bg 토큰화 + focus-visible
대상: globals.css(.nb-nav-item·--nav-hover-bg·focus-visible), NbNavItem.tsx(인라인 제거·data-state), MobileShell.tsx(hover JS 제거)
이유: 직전 NbNavItem 추출의 잔여 — 인라인 스타일/하드코딩 hover를 토큰·CSS로 완결(테마 안전·a11y 보강)
영향: 시각/동작 동일(active 아웃라인+3px바, highlight 솔리드 CTA, hover 테마별). JS hover state·리스너 제거로 단순화. 키보드 focus-visible 표식 추가. DC-REV 8.0 APPROVED
