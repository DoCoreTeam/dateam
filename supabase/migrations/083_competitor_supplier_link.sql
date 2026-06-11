-- =============================================================================
-- 083: 경쟁사 ↔ 공급사 연계 (Phase 1) + 경쟁사 시장가 원가 인입 출처 추적
-- =============================================================================
-- 목적:
--   1. 경쟁사(competitors)를 공급사(suppliers)에 연결 → 같은 회사를 양쪽 시각으로 식별
--   2. 경쟁사 시장가(market_prices)를 원가로 인입한 supply_quotes의 원본 출처 추적
--      (인입가는 supply_quotes.unit_price_usd에 스냅샷으로 고정 — 별도 가격 컬럼 불필요)
--
-- 사전 조사 결과 (2026-06-11, 운영 DB 직접 조회):
--   - 다음 마이그 번호: 083 (082까지 적용됨)
--   - competitors: PK id(uuid), supplier_id 컬럼 없음(신규 추가 대상) 확인
--   - suppliers: PK id(uuid) 확인
--   - market_prices: PK id(uuid) 확인 / 존재 확인
--   - competitor_product_mapping: PK id(uuid) 확인
--   - supply_quotes.source_format CHECK 현재 허용값:
--       ['mail','pdf','img','msg','own','text']  → 'market_link' 추가
--   - supply_quotes 인입 출처 추적 컬럼(source_market_price_id, source_competitor_id) 없음
--   - gpu_audit_logs action_type CHECK 현재 허용값(운영 DB 실측, 081까지 반영됨):
--       quote_registered, quote_confirmed, lowest_changed, expired, direct_set,
--       margin_changed, rejected, review_created, review_finalized, review_rejected,
--       review_recheck_completed, pool_stock_changed, availability_registered,
--       inquiry_sent, nonstandard_backfill, quote_supplier_assigned, quote_edited,
--       quote_deleted, product_created, product_updated, product_deleted,
--       direct_price_updated, direct_price_deleted, market_price_updated,
--       market_price_deleted, availability_deleted, pool_stock_deleted,
--       strategic_price_set, gcube_price_collected   → 'market_cost_ingested' 추가
--
-- 멱등 보장:
--   - 컬럼 추가: ADD COLUMN IF NOT EXISTS
--   - 인덱스: CREATE INDEX IF NOT EXISTS
--   - CHECK 확장: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT (079/081 패턴 동일)
--   - 재실행 시 어떤 변경도 발생하지 않음
--
-- 기존 데이터 영향: 0
--   - 신규 컬럼은 전부 NULL 허용(기본값 없음) → 기존 행 재작성/락 없음 (메타데이터 변경)
--   - CHECK는 허용값을 "추가"만 함(기존 값 전부 보존) → 기존 행 전부 통과, 위반 불가
--
-- RLS:
--   - 신규 컬럼은 소속 테이블(competitors / supply_quotes)의 기존 RLS 정책을 그대로 상속
--   - 운영 DB 확인: competitors / supply_quotes / market_prices / gpu_audit_logs 모두 RLS ON
--   - 따라서 신규 정책 추가 불필요 (STEP 5 주석 참고)
--
-- 적용 위험 / 롤백 노트: 파일 하단 참조
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- STEP 1: competitors → suppliers 연결 (경쟁사를 공급사로 식별)
-- ---------------------------------------------------------------------------
ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS supplier_id uuid NULL
  REFERENCES suppliers(id) ON DELETE SET NULL;

COMMENT ON COLUMN competitors.supplier_id IS
  '연결된 공급사(suppliers.id). 경쟁사를 공급망 시각에서 식별. 공급사 삭제 시 NULL.';

-- 조인/필터 키 인덱스 (연결된 행만 — partial)
CREATE INDEX IF NOT EXISTS idx_competitors_supplier_id
  ON competitors (supplier_id)
  WHERE supplier_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- STEP 2: supply_quotes 인입 출처 추적 컬럼
--   인입 견적(경쟁사 시장가→원가) 식별 + 원본 행 역추적.
--   인입가 자체는 unit_price_usd에 스냅샷 고정(원본 변동과 분리) — 가격 컬럼 추가 안 함.
-- ---------------------------------------------------------------------------
ALTER TABLE supply_quotes
  ADD COLUMN IF NOT EXISTS source_market_price_id uuid NULL
  REFERENCES market_prices(id) ON DELETE SET NULL;

ALTER TABLE supply_quotes
  ADD COLUMN IF NOT EXISTS source_competitor_id uuid NULL
  REFERENCES competitors(id) ON DELETE SET NULL;

COMMENT ON COLUMN supply_quotes.source_market_price_id IS
  '인입 출처 market_prices.id. 경쟁사 시장가를 원가로 인입한 견적의 원본. 원본 삭제 시 NULL(추적만 끊기고 스냅샷가 unit_price_usd는 유지).';
COMMENT ON COLUMN supply_quotes.source_competitor_id IS
  '인입 출처 경쟁사 competitors.id. 어느 경쟁사 시장가에서 인입됐는지 식별.';

-- 출처별 역추적/필터 인덱스 (인입 견적만 — partial)
CREATE INDEX IF NOT EXISTS idx_supply_quotes_source_market_price_id
  ON supply_quotes (source_market_price_id)
  WHERE source_market_price_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supply_quotes_source_competitor_id
  ON supply_quotes (source_competitor_id)
  WHERE source_competitor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- STEP 3: supply_quotes.source_format CHECK 확장 — 'market_link' 추가
--   기존 허용값 전부 보존 + 인입 견적용 'market_link' 1개 추가.
--   멱등: DROP IF EXISTS + ADD.
-- ---------------------------------------------------------------------------
ALTER TABLE supply_quotes DROP CONSTRAINT IF EXISTS supply_quotes_source_format_check;
ALTER TABLE supply_quotes ADD CONSTRAINT supply_quotes_source_format_check
  CHECK (source_format = ANY (ARRAY[
    -- 기존 허용값 (전부 유지)
    'mail', 'pdf', 'img', 'msg', 'own', 'text',
    -- 083 신규: 경쟁사 시장가 인입 견적
    'market_link'
  ]));

-- ---------------------------------------------------------------------------
-- STEP 4: gpu_audit_logs action_type CHECK 확장 — 'market_cost_ingested' 추가
--   운영 DB 실측 허용값(081까지) 전부 유지 + 1개 추가 (079/081 패턴 동일).
-- ---------------------------------------------------------------------------
ALTER TABLE gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
ALTER TABLE gpu_audit_logs ADD CONSTRAINT gpu_audit_logs_action_type_check
  CHECK (action_type = ANY (ARRAY[
    -- 078~081 허용값 (운영 DB 실측, 전부 유지)
    'quote_registered', 'quote_confirmed', 'lowest_changed', 'expired',
    'direct_set', 'margin_changed', 'rejected',
    'review_created', 'review_finalized', 'review_rejected', 'review_recheck_completed',
    'pool_stock_changed', 'availability_registered', 'inquiry_sent',
    'nonstandard_backfill',
    'quote_supplier_assigned', 'quote_edited', 'quote_deleted',
    'product_created', 'product_updated', 'product_deleted',
    'direct_price_updated', 'direct_price_deleted',
    'market_price_updated', 'market_price_deleted',
    'availability_deleted', 'pool_stock_deleted',
    'strategic_price_set',        -- 080
    'gcube_price_collected',      -- 081
    -- 083 신규: 경쟁사 시장가 원가 인입
    'market_cost_ingested'
  ]));

-- ---------------------------------------------------------------------------
-- STEP 5: RLS (확인만 — 추가 불필요)
--   신규 컬럼은 competitors / supply_quotes 기존 RLS 정책을 그대로 상속.
--   운영 DB에서 competitors / supply_quotes / market_prices / gpu_audit_logs
--   모두 RLS ON 확인됨. 새 정책/대상 컬럼 없음 → 정책 추가 없음.
-- ---------------------------------------------------------------------------

COMMIT;

-- =============================================================================
-- 적용 위험 (Risk)
-- =============================================================================
-- [낮음] 신규 컬럼 3개 전부 NULL 허용·기본값 없음 → Postgres 11+ 메타데이터 변경,
--        전체 테이블 재작성/장기 락 없음. 대형 테이블에서도 즉시 완료.
-- [낮음] CHECK 2종은 ALTER TABLE ... ADD CONSTRAINT 시 기존 행 전수 검증(SHARE 락,
--        짧음). 허용값을 추가만 했으므로 기존 행은 100% 통과 — 실패 가능성 없음.
-- [낮음] FK 3종(supplier_id / source_market_price_id / source_competitor_id)은
--        ON DELETE SET NULL → 부모 행 삭제가 차단되지 않음(인입 견적 가격은
--        unit_price_usd 스냅샷으로 유지, 추적 링크만 NULL 처리).
-- [주의] DROP CONSTRAINT ~ ADD CONSTRAINT 사이 짧은 순간 제약 부재 구간 존재.
--        단일 트랜잭션(BEGIN/COMMIT) 내라 외부 트랜잭션에는 노출되지 않음.
--
-- =============================================================================
-- 롤백 (Rollback) — 새 forward 마이그레이션으로 수행 권장. 수동 롤백 SQL:
-- =============================================================================
--   BEGIN;
--   -- CHECK 원복 (083 추가값 제거)
--   ALTER TABLE supply_quotes DROP CONSTRAINT IF EXISTS supply_quotes_source_format_check;
--   ALTER TABLE supply_quotes ADD CONSTRAINT supply_quotes_source_format_check
--     CHECK (source_format = ANY (ARRAY['mail','pdf','img','msg','own','text']));
--   ALTER TABLE gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
--   -- ↑ 081까지의 허용값 배열로 재생성 (079/081 마이그 참조)
--
--   -- 인덱스 제거
--   DROP INDEX IF EXISTS idx_supply_quotes_source_competitor_id;
--   DROP INDEX IF EXISTS idx_supply_quotes_source_market_price_id;
--   DROP INDEX IF EXISTS idx_competitors_supplier_id;
--
--   -- 컬럼 제거 (주의: 인입 견적의 출처 추적/공급사 연결 데이터 영구 소실)
--   ALTER TABLE supply_quotes DROP COLUMN IF EXISTS source_competitor_id;
--   ALTER TABLE supply_quotes DROP COLUMN IF EXISTS source_market_price_id;
--   ALTER TABLE competitors  DROP COLUMN IF EXISTS supplier_id;
--   COMMIT;
--
--   -- 롤백 전제: source_format='market_link' / action_type='market_cost_ingested'
--   --   행이 존재하면 CHECK 원복이 실패함. 해당 행을 먼저 정리/이관해야 함.
-- =============================================================================
