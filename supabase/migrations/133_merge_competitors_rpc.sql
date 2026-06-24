-- 133_merge_competitors_rpc.sql
-- 경쟁사 병합 실행을 단일 트랜잭션으로 보장(DC-REV HIGH-1: supabase-js는 트랜잭션 미지원 →
--   다단계 update 중간 실패 시 좀비 상태 발생). 계획(어떤 매핑을 이관/충돌처리할지)은
--   TS SSOT(planCompetitorMerge)에서 계산하고, 이 함수는 그 계획을 받아 원자적으로 적용만 한다.
--   plpgsql 함수 본문은 단일 트랜잭션에서 실행 → 전부 성공 또는 전부 롤백.

CREATE OR REPLACE FUNCTION merge_competitors_apply(
  p_canonical   uuid,
  p_aliases     text[],
  p_repoint     uuid[],
  p_deactivate  uuid[],
  p_collisions  jsonb,          -- [{ "from": "<mapping_id>", "to": "<mapping_id>" }, ...]
  p_absorbed    uuid[],
  p_website     text DEFAULT NULL,
  p_supplier    uuid DEFAULT NULL,
  p_color       text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  c jsonb;
BEGIN
  -- 1) 충돌 매핑의 시장가를 캐노니컬 기존 매핑으로 이관
  IF p_collisions IS NOT NULL THEN
    FOR c IN SELECT * FROM jsonb_array_elements(p_collisions) LOOP
      UPDATE market_prices
        SET mapping_id = (c->>'to')::uuid
        WHERE mapping_id = (c->>'from')::uuid;
    END LOOP;
  END IF;

  -- 2) 충돌(흡수)된 중복 매핑 비활성
  IF p_deactivate IS NOT NULL AND array_length(p_deactivate, 1) IS NOT NULL THEN
    UPDATE competitor_product_mapping
      SET is_active = false
      WHERE id = ANY(p_deactivate);
  END IF;

  -- 3) 비충돌 매핑을 캐노니컬로 이관
  IF p_repoint IS NOT NULL AND array_length(p_repoint, 1) IS NOT NULL THEN
    UPDATE competitor_product_mapping
      SET competitor_id = p_canonical
      WHERE id = ANY(p_repoint);
  END IF;

  -- 4) 캐노니컬: 별칭 보존 + 비어있는 도메인/공급사연결/색 보전
  UPDATE competitors
    SET aliases     = p_aliases,
        website_url = COALESCE(website_url, p_website),
        supplier_id = COALESCE(supplier_id, p_supplier),
        color       = COALESCE(color, p_color)
    WHERE id = p_canonical;

  -- 5) 흡수 회사 soft-delete
  IF p_absorbed IS NOT NULL AND array_length(p_absorbed, 1) IS NOT NULL THEN
    UPDATE competitors
      SET deleted_at = now(), is_active = false
      WHERE id = ANY(p_absorbed);
  END IF;
END;
$$;

COMMENT ON FUNCTION merge_competitors_apply IS '경쟁사 병합을 단일 트랜잭션으로 적용. 계획은 TS planCompetitorMerge(SSOT)에서 계산.';
