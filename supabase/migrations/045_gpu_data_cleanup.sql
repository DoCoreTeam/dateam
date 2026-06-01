-- 045_gpu_data_cleanup.sql
-- 데이터 정리(견적 0건 mis-seed 제거) — 라이브에 직접 적용됨, 재현용 기록
-- ① RTX가 Tier1에 잘못 분류된 행(견적0) 제거/이동
DELETE FROM gpu_products p WHERE p.model_name ILIKE 'RTX%' AND p.tier=1
  AND NOT EXISTS(SELECT 1 FROM supply_quotes sq WHERE sq.product_id=p.id)
  AND EXISTS(SELECT 1 FROM gpu_products s WHERE s.model_name=p.model_name AND s.memory=p.memory AND s.gpu_count=p.gpu_count AND s.tier IN (2,3));
UPDATE gpu_products SET tier=2 WHERE model_name ILIKE 'RTX%' AND tier=1
  AND NOT EXISTS(SELECT 1 FROM supply_quotes sq WHERE sq.product_id=gpu_products.id);
-- ② B200 192GB x1 중복(견적0) 제거
DELETE FROM gpu_products p WHERE p.model_name='B200' AND p.gpu_count=1 AND p.memory='192GB'
  AND NOT EXISTS(SELECT 1 FROM supply_quotes sq WHERE sq.product_id=p.id);
-- ③ T4/Tesla P100 동일(model,gpu_count) 중복 중 견적0 제거
DELETE FROM gpu_products p WHERE p.model_name IN ('T4','Tesla P100')
  AND NOT EXISTS(SELECT 1 FROM supply_quotes sq WHERE sq.product_id=p.id)
  AND EXISTS(SELECT 1 FROM gpu_products o WHERE o.model_name=p.model_name AND o.gpu_count=p.gpu_count AND o.id<>p.id);
