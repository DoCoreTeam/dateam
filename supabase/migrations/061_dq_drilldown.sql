-- 061: 데이터 품질 드릴다운 함수 (관리자 대시보드 지표→상세). 060 메트릭과 동일 밴드(SSOT).

-- 이상치 견적 상세
CREATE OR REPLACE FUNCTION public.get_anomaly_quotes()
RETURNS TABLE(quote_id uuid, model_name text, tier int, unit_price_usd numeric, reason text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, g.model_name, g.tier, s.unit_price_usd,
    CASE g.tier
      WHEN 1 THEN 'Tier1 밴드($0.08~150) 밖'
      WHEN 2 THEN 'Tier2 밴드($0.03~40) 밖'
      WHEN 3 THEN 'Tier3 밴드($0.02~20) 밖'
    END
  FROM supply_quotes s JOIN gpu_products g ON g.id = s.product_id
  WHERE s.status='confirmed' AND s.unit_price_usd IS NOT NULL AND (
    (g.tier=1 AND (s.unit_price_usd<0.08 OR s.unit_price_usd>150)) OR
    (g.tier=2 AND (s.unit_price_usd<0.03 OR s.unit_price_usd>40)) OR
    (g.tier=3 AND (s.unit_price_usd<0.02 OR s.unit_price_usd>20)))
  ORDER BY s.unit_price_usd
  LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION public.get_anomaly_quotes() TO authenticated, service_role;

-- 중복 의심: pending 중 동일 product_hint+신뢰도 2건+ (대표 1건 + 중복수)
CREATE OR REPLACE FUNCTION public.get_dup_suspects()
RETURNS TABLE(product_hint text, overall_confidence int, dup_count bigint, ids uuid[])
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT product_hint, overall_confidence, count(*) dup_count, array_agg(id) ids
  FROM review_items
  WHERE status='pending' AND is_test=false AND product_hint IS NOT NULL
  GROUP BY product_hint, overall_confidence
  HAVING count(*) > 1
  ORDER BY count(*) DESC
  LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION public.get_dup_suspects() TO authenticated, service_role;
