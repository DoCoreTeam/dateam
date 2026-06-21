-- =============================================================================
-- 129_gpu_phantom_config_cleanup.sql
-- 유령 구성행 정리(v0.7.240) — ensureStandardConfigs가 2026-06-10에 일괄 생성한
-- "견적 0건 ×N 파생 구성행"(가격 전파로 +355% 오가격 유발)을 소프트삭제(deleted_at).
-- 안전·가역: ① 전체 스냅샷 백업테이블 생성 ② soft-delete(행 보존, 복원 가능) ③ 보수적 필터.
-- 보존: gcube 시드·실제 견적행·전략가/직접가/재고 참조행·단일카드.  중복 0 + 가격 회귀 0.
-- 롤백: 아래 [ROLLBACK] 쿼리로 deleted_at 복원(백업테이블은 검증 후 수동 DROP).
-- =============================================================================

-- STEP 1: 전체 스냅샷 백업 (롤백 원천)
DROP TABLE IF EXISTS gpu_products_dedup_backup_20260622;
CREATE TABLE gpu_products_dedup_backup_20260622 AS
  SELECT * FROM gpu_products;

-- STEP 2: 유령 ×N 파생 구성행만 소프트삭제 (보수적 다중조건)
UPDATE gpu_products p
SET deleted_at = now()
WHERE p.deleted_at IS NULL
  AND p.pricing_mode = 'quote'          -- 시드 list/own_target 제외
  AND p.gpu_count > 1                   -- 단일카드 보존(파생 ×N만)
  AND p.gcube_last_status IS NULL       -- gcube 카탈로그 보존
  AND p.strategic_price_krw IS NULL     -- 전략가 설정행 보존
  AND NOT EXISTS (SELECT 1 FROM supply_quotes q WHERE q.product_id = p.id)        -- 실견적 보존
  AND NOT EXISTS (SELECT 1 FROM availability_responses a WHERE a.product_id = p.id) -- 재고 참조 보존
  AND NOT EXISTS (SELECT 1 FROM direct_prices d WHERE d.product_id = p.id);        -- 직접가 참조 보존

-- =============================================================================
-- [ROLLBACK] (필요 시 별도 실행 — 이 파일에 포함하지 말 것)
--   UPDATE gpu_products g SET deleted_at = b.deleted_at
--     FROM gpu_products_dedup_backup_20260622 b WHERE g.id = b.id;
--   -- 검증 후: DROP TABLE gpu_products_dedup_backup_20260622;
-- =============================================================================
