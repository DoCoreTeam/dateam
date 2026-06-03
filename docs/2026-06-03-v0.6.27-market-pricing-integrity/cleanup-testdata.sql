-- 테스트 데이터 정리 (2026-06-03 UI 통합테스트) — 매니페스트 기준
-- FK 순서: availability → quotes → suppliers

BEGIN;

-- 1) 가용량 응답 (RalphTest 공급사 + is_test)
DELETE FROM availability_responses
WHERE supplier_id = '21da323a-2640-4cc2-a6c8-d8ce69637225'
   OR (is_test = true AND product_id = 'f376f0e4-77e7-476f-b95f-2bbfcbf7c823'
       AND received_at::date = '2026-06-03');

-- 2) 테스트 견적
DELETE FROM supply_quotes
WHERE id = 'f9df735b-46bf-4ea9-aabc-4a824a553827'
   OR supplier_id = '21da323a-2640-4cc2-a6c8-d8ce69637225';

-- 3) 테스트 공급사
DELETE FROM suppliers
WHERE id = '21da323a-2640-4cc2-a6c8-d8ce69637225'
   OR name LIKE '[[TESTDATA%';

COMMIT;
