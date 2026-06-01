-- =============================================================================
-- 044_gpu_pricing_integrity.sql
-- GPU 가격 데이터 정합 아키텍처 기반 (가산적·안전)
--   ① supply_quotes.gpu_count (입력 수량) — per-GPU 환산 기준
--   ② status 'superseded' 추가 (공급사 멱등 이력 보존)
--   ③ (product_id, supplier_id, term_months) 부분 유니크 — 공급사당 활성 1건
--   ④ v_gpu_master — 4탭 단일 진실원천 뷰
-- 롤백: 045_drop으로 별도 처리. 데이터 파괴 없음(ADD only).
-- =============================================================================

-- ① gpu_count: 견적이 몇 장 기준으로 들어왔는지 (1장당 환산용). 기본 1.
ALTER TABLE supply_quotes
  ADD COLUMN IF NOT EXISTS gpu_count int NOT NULL DEFAULT 1;

-- ② status에 'superseded'(공급사 멱등 갱신 시 기존 견적 이력화) 허용
ALTER TABLE supply_quotes DROP CONSTRAINT IF EXISTS supply_quotes_status_check;
ALTER TABLE supply_quotes ADD CONSTRAINT supply_quotes_status_check
  CHECK (status = ANY (ARRAY['pending','confirmed','expired','rejected','superseded']));

-- ③ 공급사당 활성(confirmed) 견적 1건 — supplier_id 있는 경우만 (NULL은 멱등 불가)
--    term_months NULL은 동일 그룹으로 묶기 위해 COALESCE(-1) 표현식 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_quote_per_supplier
  ON supply_quotes (product_id, supplier_id, COALESCE(term_months, -1))
  WHERE status = 'confirmed' AND supplier_id IS NOT NULL;

-- ④ v_gpu_master — 4탭 공통 단일 소스
--    gpu_products 기준 LEFT JOIN: 최저견적 / 직접가 / 가용량요약 / 풀재고
CREATE OR REPLACE VIEW v_gpu_master AS
  SELECT
    p.id, p.model_name, p.memory, p.tier, p.gpu_count, p.pricing_mode, p.series,
    lq.unit_price_usd        AS lowest_unit_price_usd,
    lq.supplier_id           AS lowest_supplier_id,
    lq.valid_until           AS lowest_valid_until,
    dp.sell_price_krw        AS direct_sell_price_krw,
    av.fresh_available_qty,
    av.oos_supplier_count,
    av.stale_count,
    av.pending_review_count,
    av.latest_response_at,
    ps.pool_qty,
    -- 견적 보유 여부(공급 가능 신호) — 재고탭이 가용량 0이어도 활용
    (lq.unit_price_usd IS NOT NULL) AS has_active_quote
  FROM gpu_products p
  LEFT JOIN v_lowest_quotes lq           ON lq.product_id = p.id
  LEFT JOIN direct_prices dp             ON dp.product_id = p.id AND dp.is_current = true
  LEFT JOIN v_product_availability_summary av ON av.product_id = p.id
  LEFT JOIN direct_pool_stock ps         ON ps.product_id = p.id AND ps.is_current = true;
