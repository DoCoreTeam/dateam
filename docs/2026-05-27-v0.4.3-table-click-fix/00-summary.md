# FAST PATH Summary
작업: 테이블 card-header td의 stopPropagation 제거 — 셀 클릭 시 상세 패널 미열림 버그 수정
대상: apps/web/app/(member)/accounts/page.tsx, apps/web/app/(member)/contacts/page.tsx
이유: card-header td에 onClick stopPropagation이 있어 row의 setSelected 호출이 블록됨. 내부 button이 setSelected를 직접 호출하므로 td 레벨 stopPropagation 불필요
영향: deals/page.tsx는 card-header에 stopPropagation 없으므로 수정 불필요
