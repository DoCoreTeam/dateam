-- H6: 데이터 품질 메트릭 집계 함수 (관리자 대시보드 전용). get_schema_digest와 동일 패턴(SSOT, RPC).
-- 신뢰도·정합성 지표를 한 번에 JSON으로 반환 — review_items·supply_quotes·gpu_audit_logs·gpu_products 소스.

CREATE OR REPLACE FUNCTION public.get_data_quality_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ri jsonb; sq jsonb; anomaly int; blocked7 int; dup int;
BEGIN
  -- 검토 항목(review_items) — 상태 분포 + 저신뢰
  SELECT jsonb_build_object(
    'total', count(*),
    'pending', count(*) FILTER (WHERE status='pending'),
    'confirmed', count(*) FILTER (WHERE status='confirmed'),
    'rejected', count(*) FILTER (WHERE status='rejected'),
    'superseded', count(*) FILTER (WHERE status='superseded'),
    'low_confidence', count(*) FILTER (WHERE overall_confidence IS NOT NULL AND overall_confidence < 60)
  ) INTO ri FROM review_items WHERE is_test = false;

  -- 공급 견적(supply_quotes) — 상태 + 평균 신뢰도 + 신뢰도 버킷
  SELECT jsonb_build_object(
    'total', count(*),
    'confirmed', count(*) FILTER (WHERE status='confirmed'),
    'avg_confidence', round(avg(ai_confidence) FILTER (WHERE ai_confidence IS NOT NULL)),
    'high', count(*) FILTER (WHERE ai_confidence >= 90),
    'mid', count(*) FILTER (WHERE ai_confidence >= 60 AND ai_confidence < 90),
    'low', count(*) FILTER (WHERE ai_confidence IS NOT NULL AND ai_confidence < 60)
  ) INTO sq FROM supply_quotes;

  -- 이상치(H4): 확정 견적 단가가 tier 상식밴드 밖 (1:0.08~150 / 2:0.03~40 / 3:0.02~20 — 허위경보 방지로 하한 현실화)
  SELECT count(*) INTO anomaly
  FROM supply_quotes s JOIN gpu_products g ON g.id = s.product_id
  WHERE s.status='confirmed' AND s.unit_price_usd IS NOT NULL AND (
    (g.tier=1 AND (s.unit_price_usd < 0.08 OR s.unit_price_usd > 150)) OR
    (g.tier=2 AND (s.unit_price_usd < 0.03 OR s.unit_price_usd > 40)) OR
    (g.tier=3 AND (s.unit_price_usd < 0.02 OR s.unit_price_usd > 20))
  );

  -- 검증 게이트 차단 누계(최근 audit detail.blocked 합)
  SELECT COALESCE(SUM((detail->>'blocked')::int), 0) INTO blocked7
  FROM gpu_audit_logs WHERE detail ? 'blocked';

  -- 중복 의심: pending 중 동일 product_hint가 2건 이상
  SELECT COALESCE(SUM(c - 1), 0) INTO dup FROM (
    SELECT count(*) c FROM review_items WHERE status='pending' AND is_test=false AND product_hint IS NOT NULL
    GROUP BY product_hint, overall_confidence HAVING count(*) > 1
  ) d;

  RETURN jsonb_build_object(
    'review_items', ri,
    'supply_quotes', sq,
    'anomaly_count', anomaly,
    'validation_blocked', blocked7,
    'dup_suspects', dup
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_data_quality_metrics() TO authenticated, service_role;
