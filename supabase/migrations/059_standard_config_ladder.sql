-- 059: 표준 구성 사다리(×1/×2/×4/×8) 실제 적재 (B안 — DB 적재)
-- ×1 견적만 있어도 ×2/×4/×8이 가격표·시장비교·재고·고객판매가격표·스펙관리 전부에 일관되게 나오도록,
-- 화면 전용 파생이 아니라 실제 gpu_products 행으로 생성. 각 모델의 최소 구성에서 선형 스케일.

INSERT INTO gpu_products (model_name, tier, pricing_mode, gpu_count, series, memory, vcpu, ram_gb, storage_gb)
SELECT
  b.model_name, b.tier, 'quote', s.n, b.series,
  CASE WHEN b.memory ~ '[0-9]'
       THEN round((regexp_replace(b.memory, '[^0-9]', '', 'g'))::numeric / greatest(b.gpu_count, 1) * s.n)::text || 'GB'
       ELSE b.memory END,
  round(b.vcpu::numeric   / greatest(b.gpu_count, 1) * s.n)::int,
  round(b.ram_gb::numeric / greatest(b.gpu_count, 1) * s.n)::int,
  CASE WHEN b.storage_gb IS NOT NULL
       THEN round(b.storage_gb::numeric / greatest(b.gpu_count, 1) * s.n)::int
       ELSE NULL END
FROM (
  SELECT DISTINCT ON (model_name) model_name, tier, series, memory, gpu_count, vcpu, ram_gb, storage_gb
  FROM gpu_products
  WHERE pricing_mode = 'quote'
  ORDER BY model_name, gpu_count ASC          -- 최소 구성을 base로
) b
CROSS JOIN (SELECT unnest(ARRAY[1, 2, 4, 8]) AS n) s
WHERE NOT EXISTS (
  SELECT 1 FROM gpu_products g WHERE g.model_name = b.model_name AND g.gpu_count = s.n
)
ON CONFLICT DO NOTHING;
