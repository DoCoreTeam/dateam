# FAST PATH Summary
작업: 조직도 트리 레이아웃 정렬 수정 + DnD 핸들 카드 전체로 확장
대상: apps/web/app/admin/org-chart/OrgNodeCard.tsx, OrgTree.tsx
이유: 1) react-organizational-chart 선/카드 미정렬 — 트리 컨테이너 중앙 정렬 필요 2) DnD useDraggable listeners가 GripVertical 아이콘에만 연결돼 좌상단만 드래그 됨
영향: OrgNodeCard.tsx (DragDropWrapper, ActionBar), OrgTree.tsx (Tree 컨테이너)
