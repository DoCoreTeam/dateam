# FAST PATH Summary — GPU 가격표 버그 클러스터 수정
작업: B300 공급가 입력 후 발견된 6대 버그 중 5건 수정 (④는 데이터모델 확인 필요로 보류)
대상:
 - supabase/migrations/043_lowest_quotes_valid_until_null.sql (②)
 - app/api/pricing/gpu/review/[id]/route.ts (③ 공급사 find-or-create)
 - app/(member)/pricing/gpu/tabs/PriceTableTab.tsx (① 토글 제거 + memory null 가드)
 - app/(member)/pricing/gpu/tabs/InventoryTab.tsx (⑤ memory null 가드)
근거:
 ② v_lowest_quotes가 valid_until>=CURRENT_DATE 필터 → B300(valid_until NULL) 제외 → NULL 허용으로 수정
 ③ confirm route가 공급사 검색만(생성 안함) → find-or-create로 수정 + B300 기존 3건 supplier 백필(Konsttech/Tensordock)
 ① 견적확정만/전체 토글 제거 → 항상 전체상품
 ⑤ p.memory(nullable).toLowerCase() 크래시 → (p.memory ?? '') 가드 (Inventory+PriceTable)
 ⑥ ③ 수정으로 공급사 명시 + gpu_audit_logs review_finalized 기록
영향: 기존 가격 계산 로직 무변경. ④(gpu_count 곱셈)는 기존 멀티GPU 상품이 박스가격 저장이라 일괄곱셈 시 손상 → 별도 확인
