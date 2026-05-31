# FAST PATH Summary
작업: 사이드바에 "판매가격표" 메뉴 추가 + 고객용 마진 적용 GPU 판매가격표 페이지 신규 생성
대상: apps/web/app/(member)/pricing/catalog/page.tsx (신규), apps/web/app/(member)/layout.tsx (메뉴 추가)
이유: 내부 GPU 가격관리 탭과 분리된 고객 공유용 판매가격표 필요. 공급가/공급사 정보 비노출, 마진 적용 판매가만 표시
영향: layout.tsx NAV_GROUPS 가격정책 그룹에 항목 추가. 기존 GPU 가격관리 탭 무영향.
