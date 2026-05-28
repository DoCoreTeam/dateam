-- 028: gcube 초기 금액 audit log 백필
-- migration 027로 직접 삽입된 104개 gcube 견적에 대한 이력 생성

INSERT INTO gpu_audit_logs (ts, actor, action_type, product_id, detail, evidence_ref)
SELECT
  sq.received_at,
  sq.registered_by,
  'quote_registered',
  sq.product_id,
  jsonb_build_object(
    'quote_id', sq.id,
    'unit_price_usd', sq.unit_price_usd,
    'supplier_id', sq.supplier_id,
    'source', 'gcube_bulk_import'
  ),
  sq.id::text
FROM supply_quotes sq
WHERE sq.supplier_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  AND sq.status = 'confirmed'
ORDER BY sq.received_at;

INSERT INTO gpu_audit_logs (ts, actor, action_type, product_id, detail, evidence_ref)
SELECT
  sq.confirmed_at,
  sq.confirmed_by,
  'quote_confirmed',
  sq.product_id,
  jsonb_build_object(
    'quote_id', sq.id,
    'unit_price_usd', sq.unit_price_usd,
    'supplier_id', sq.supplier_id,
    'source', 'gcube_bulk_import'
  ),
  sq.id::text
FROM supply_quotes sq
WHERE sq.supplier_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  AND sq.status = 'confirmed'
ORDER BY sq.confirmed_at;
