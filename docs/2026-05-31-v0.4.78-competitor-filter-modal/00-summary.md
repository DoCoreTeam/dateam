# FAST PATH Summary
작업: 시장 비교 탭 경쟁사 필터 — 배지 나열 → 모달 방식으로 변경
대상: apps/web/app/(member)/pricing/gpu/tabs/MarketTab.tsx
이유: 경쟁사 12곳을 배지로 나열하면 줄 넘침으로 레이아웃 깨짐 발생
영향: 기존 activeComps Set 필터 로직 동일, 그룹 필터(activeGroups)는 그대로 유지

## 변경 내용
- 경쟁사 칩 나열 제거 → "전체 ▾" 버튼으로 교체
- 버튼 클릭 시 모달 오버레이 표시 (position:fixed, z-index:1000)
- 모달 내 경쟁사를 COMP_GROUPS 기준 그룹별 분류 표시
- 선택 시: 색상 도트 미리보기 + "N개 선택" 표시 + "초기화" 버튼 노출
- 배경 클릭, X버튼, "확인" 버튼으로 모달 닫기
