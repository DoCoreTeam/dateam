# FAST PATH Summary
작업: 조직도 zoom/pan 캔버스 적용 — 오른쪽 잘림 문제 해결
대상: apps/web/app/admin/org-chart/OrgTree.tsx
이유: 조직이 넓어질수록 오른쪽 노드가 레이아웃에 잘림 → 마우스 휠 줌 + 드래그 팬 + 줌 버튼으로 한 화면에서 전체 트리 탐색 가능하도록
영향: 없음 (OrgTree.tsx 단일 파일 수정)
