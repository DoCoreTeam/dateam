-- supplier_id NULL confirmed 견적 5건 정리 (2026-06-04)
-- 근거: gpu_audit_logs.detail->>'supplier_hint' (review_finalized 시점 원본 공급사명)
--   · 로그에 단서 있으면 → 공급사 복원 + 연결
--   · 단서 없으면(test 출처) → 제거 (부정확한 데이터는 없는 게 낫다 — 사용자 지시)

BEGIN;

-- 1) 로그 단서로 누락 공급사 생성 (없을 때만)
INSERT INTO suppliers (name, color)
SELECT v.name, v.color
FROM (VALUES
  ('Voltage Park',  '#f59e0b'),
  ('Equinix Metal', '#ef4444'),
  ('CoreWeave',     '#8b5cf6')
) AS v(name, color)
WHERE NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.name = v.name);

-- 2) 로그 근거로 공급사 복원 연결
UPDATE supply_quotes SET supplier_id = (SELECT id FROM suppliers WHERE name = 'Voltage Park'  LIMIT 1)
WHERE id = 'eeb7d115-335d-48e7-bafc-5626d78da50f';  -- A100 40GB $2.35 ← Voltage Park
UPDATE supply_quotes SET supplier_id = (SELECT id FROM suppliers WHERE name = 'Equinix Metal' LIMIT 1)
WHERE id = '113575f2-ce38-427a-988e-7831e776efdf';  -- A100 40GB $1.95 ← Equinix Metal
UPDATE supply_quotes SET supplier_id = (SELECT id FROM suppliers WHERE name = 'CoreWeave'     LIMIT 1)
WHERE id = '5f183ae8-945e-472f-a937-7df587a07a50';  -- H100 80GB $5.80 ← CoreWeave

-- 3) 증거 없는 견적 제거 (로그 0건 · test 출처)
DELETE FROM supply_quotes
WHERE id IN (
  '7b8b62c3-c159-41a4-a273-18b0fc3e74d2',  -- GX7000 PRO $4.50 (로그 0건)
  'e4de4766-4a5f-4496-8044-9081cef4316f'   -- RTX 5090 $9.99 (로그 0건)
);

-- 4) 상품(product_id) 미연결 confirmed 견적 제거 (5건)
--    상품이 없으면 어느 모델에도 표시 불가 = 사용불가 데이터. 복원 불가(로그에도 product 없음).
--    부정확한 데이터는 없는 게 낫다 (사용자 지시).
DELETE FROM supply_quotes
WHERE status = 'confirmed' AND product_id IS NULL;

COMMIT;

-- 실행 결과(2026-06-04): UPDATE 3(공급사 복원) · DELETE 2(증거없음) · DELETE 5(상품없음)
-- → confirmed 견적 supplier_id NULL 0건 / product_id NULL 0건 (총 111건 모두 정상)
