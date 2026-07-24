-- 174_gpu_products_merge_rpc.sql
-- 제품(gpu_products) 완전중복 병합 SSOT — 경쟁사 병합 RPC(133)와 동형.
--   왜: supabase-js는 트랜잭션 미지원 → 13개 FK 재연결을 다단계로 하면 중간 실패 시 좀비 상태.
--   이 함수는 단일 plpgsql 트랜잭션에서 survivor로 모든 참조를 재연결하고 losers를 소프트삭제한다(무손실).
--   유니크/PK(product_id) 제약이 있는 테이블은 survivor에 같은 키가 이미 있으면 loser행을 삭제(survivor 우선),
--   그 외에는 평범 repoint. additive only — 스키마 변경 없음.

CREATE OR REPLACE FUNCTION merge_gpu_products_apply(
  p_survivor uuid,
  p_losers   uuid[]
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_survivor IS NULL OR p_losers IS NULL OR array_length(p_losers, 1) IS NULL THEN
    RETURN;
  END IF;
  -- survivor가 losers에 섞여 들어오면 자기병합 사고 → 방어
  IF p_survivor = ANY(p_losers) THEN
    RAISE EXCEPTION 'survivor % must not be in losers', p_survivor;
  END IF;

  -- ── 유니크/PK(product 기준) 제약 테이블: 충돌 loser 삭제 후 repoint ──
  -- competitor_product_mapping U(competitor_id, gpu_product_id, pricing_model)
  DELETE FROM competitor_product_mapping l
    WHERE l.gpu_product_id = ANY(p_losers)
      AND EXISTS (SELECT 1 FROM competitor_product_mapping s
                  WHERE s.gpu_product_id = p_survivor
                    AND s.competitor_id = l.competitor_id
                    AND s.pricing_model IS NOT DISTINCT FROM l.pricing_model);
  UPDATE competitor_product_mapping SET gpu_product_id = p_survivor WHERE gpu_product_id = ANY(p_losers);

  -- gpu_product_term_prices U(product_id, term)
  DELETE FROM gpu_product_term_prices l
    WHERE l.product_id = ANY(p_losers)
      AND EXISTS (SELECT 1 FROM gpu_product_term_prices s
                  WHERE s.product_id = p_survivor AND s.term = l.term);
  UPDATE gpu_product_term_prices SET product_id = p_survivor WHERE product_id = ANY(p_losers);

  -- supply_history_stats PK(product_id)
  DELETE FROM supply_history_stats l
    WHERE l.product_id = ANY(p_losers)
      AND EXISTS (SELECT 1 FROM supply_history_stats s WHERE s.product_id = p_survivor);
  UPDATE supply_history_stats SET product_id = p_survivor WHERE product_id = ANY(p_losers);

  -- price_range_learned PK(product_id)
  DELETE FROM price_range_learned l
    WHERE l.product_id = ANY(p_losers)
      AND EXISTS (SELECT 1 FROM price_range_learned s WHERE s.product_id = p_survivor);
  UPDATE price_range_learned SET product_id = p_survivor WHERE product_id = ANY(p_losers);

  -- pricing_strategy_config U(scope, product_id)
  DELETE FROM pricing_strategy_config l
    WHERE l.product_id = ANY(p_losers)
      AND EXISTS (SELECT 1 FROM pricing_strategy_config s
                  WHERE s.product_id = p_survivor AND s.scope IS NOT DISTINCT FROM l.scope);
  UPDATE pricing_strategy_config SET product_id = p_survivor WHERE product_id = ANY(p_losers);

  -- supply_quotes: 부분 유니크 인덱스 3개 대응 후 repoint
  --   (a) uq_supply_quotes_selected_per_product: (product_id) WHERE is_selected — product당 선택 1개.
  --       survivor에 선택본이 있으면 loser 선택 전부 해제, 없으면 loser 중 최소 id 하나만 유지.
  WITH keep_sel AS (
    SELECT id FROM supply_quotes
    WHERE product_id = ANY(p_losers) AND is_selected = true
      AND NOT EXISTS (SELECT 1 FROM supply_quotes s WHERE s.product_id = p_survivor AND s.is_selected = true)
    ORDER BY id ASC LIMIT 1
  )
  UPDATE supply_quotes SET is_selected = false
    WHERE product_id = ANY(p_losers) AND is_selected = true
      AND id NOT IN (SELECT id FROM keep_sel);
  --   (b) uq_active_quote_per_supplier: (product_id, supplier_id, COALESCE(term_months,-1)) WHERE status='confirmed' AND supplier_id NOT NULL.
  --       완전중복 제품이므로 같은 (supplier, term) confirmed 견적은 진짜 중복 → survivor(우선)/최소 id 하나만 남기고 loser분 삭제.
  DELETE FROM supply_quotes l
    WHERE l.product_id = ANY(p_losers) AND l.status = 'confirmed' AND l.supplier_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM supply_quotes k
        WHERE k.status = 'confirmed' AND k.supplier_id = l.supplier_id
          AND COALESCE(k.term_months, -1) = COALESCE(l.term_months, -1)
          AND (k.product_id = p_survivor OR k.product_id = ANY(p_losers))
          AND k.id <> l.id
          AND (k.product_id = p_survivor OR k.id < l.id)   -- survivor 우선, 아니면 최소 id 승
      );
  UPDATE supply_quotes          SET product_id = p_survivor WHERE product_id = ANY(p_losers);

  -- ── PK(id)만 있는 테이블: 평범 repoint ──
  UPDATE gpu_audit_logs         SET product_id = p_survivor WHERE product_id = ANY(p_losers);
  UPDATE gcube_price_checks     SET product_id = p_survivor WHERE product_id = ANY(p_losers);
  UPDATE direct_prices          SET product_id = p_survivor WHERE product_id = ANY(p_losers);
  UPDATE direct_pool_stock      SET product_id = p_survivor WHERE product_id = ANY(p_losers);
  UPDATE inquiries              SET product_id = p_survivor WHERE product_id = ANY(p_losers);
  UPDATE availability_responses SET product_id = p_survivor WHERE product_id = ANY(p_losers);
  UPDATE negotiation_cards      SET product_id = p_survivor WHERE product_id = ANY(p_losers);

  -- ── losers 소프트삭제(무손실). 이미 삭제된 건 무변 ──
  UPDATE gpu_products SET deleted_at = now() WHERE id = ANY(p_losers) AND deleted_at IS NULL;
END;
$$;

COMMENT ON FUNCTION merge_gpu_products_apply(uuid, uuid[]) IS
  '제품 완전중복 병합 SSOT: 13개 FK를 survivor로 재연결(유니크 충돌 loser 삭제) + losers 소프트삭제. 단일 트랜잭션·멱등.';

-- ── 완전중복 29그룹 일괄 병합(멱등) ──
-- 그룹키 = (model_name, form_factor, memory, gpu_count). survivor = ①확정가 보유 ②참조 많음 ③id 최소.
DO $$
DECLARE
  g RECORD;
  v_survivor uuid;
  v_losers uuid[];
BEGIN
  FOR g IN
    SELECT model_name, COALESCE(form_factor,'') ff, COALESCE(memory,'') mem, gpu_count
    FROM gpu_products WHERE deleted_at IS NULL
    GROUP BY model_name, COALESCE(form_factor,''), COALESCE(memory,''), gpu_count
    HAVING count(*) > 1
  LOOP
    SELECT id INTO v_survivor
    FROM gpu_products p
    WHERE deleted_at IS NULL
      AND p.model_name = g.model_name
      AND COALESCE(p.form_factor,'') = g.ff
      AND COALESCE(p.memory,'') = g.mem
      AND p.gpu_count = g.gpu_count
    ORDER BY
      (strategic_price_krw IS NOT NULL) DESC,
      ( (SELECT count(*) FROM competitor_product_mapping m WHERE m.gpu_product_id = p.id)
      + (SELECT count(*) FROM gpu_product_term_prices t WHERE t.product_id = p.id)
      + (SELECT count(*) FROM supply_quotes s WHERE s.product_id = p.id) ) DESC,
      id ASC
    LIMIT 1;

    SELECT array_agg(id) INTO v_losers
    FROM gpu_products p
    WHERE deleted_at IS NULL
      AND p.model_name = g.model_name
      AND COALESCE(p.form_factor,'') = g.ff
      AND COALESCE(p.memory,'') = g.mem
      AND p.gpu_count = g.gpu_count
      AND p.id <> v_survivor;

    IF v_losers IS NOT NULL AND array_length(v_losers, 1) IS NOT NULL THEN
      PERFORM merge_gpu_products_apply(v_survivor, v_losers);
    END IF;
  END LOOP;
END;
$$;
