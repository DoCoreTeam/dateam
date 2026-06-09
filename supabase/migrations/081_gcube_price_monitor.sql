-- ============================================================================
-- 081_gcube_price_monitor.sql
-- gcube.ai 가격 모니터링 — 일별 수집가 vs 우리 판매가 비교 이력
--
-- 목적:
--   gcube.ai에서 파싱한 실게시가를 우리 strategic_price_krw(또는 자동마진가)와
--   매일 비교해 그 결과를 저장한다.
--   - 이력 테이블: gcube_price_checks  (매 수집 행 보존, append-only)
--   - 캐시 컬럼 : gpu_products.gcube_last_* (콕핏 즉시 표시용, 파서가 갱신)
--
-- 멱등성: IF NOT EXISTS / DO $$ 가드 / pg_constraint 가드
-- 기존 데이터 파괴: 없음 (신규 테이블 + nullable 컬럼 추가만)
-- RLS: 024 패턴 동일 (service_role 쓰기, authenticated 읽기)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: gcube_price_checks — 가격 비교 이력 테이블 (신규)
-- ============================================================================
-- product_id NULL 허용 이유:
--   gcube 파싱 행이 우리 gpu_products에 매칭되지 않을 경우 미매칭 행도 기록해
--   "파악 못 한 상품" 목록 파악에 활용.
--
-- status 값:
--   match       — gcube_low_krw ≤ our_price_krw ≤ gcube_high_krw (범위 내)
--   mismatch    — 가격이 범위 밖 (우리가 너무 비싸거나 낮음)
--   not_found   — gcube에는 있지만 우리 gpu_products에 매칭 없음
--   our_unset   — 우리 판매가(strategic + 자동마진)가 NULL/미설정 상태

CREATE TABLE IF NOT EXISTS gcube_price_checks (
  -- ── 식별자 ──────────────────────────────────────────────────
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── 관계 ────────────────────────────────────────────────────
  product_id        uuid        NULL
    REFERENCES gpu_products(id) ON DELETE CASCADE,
  -- NULL = gcube에만 있고 우리 테이블에 매칭 안 된 행

  -- ── 수집 시각 ────────────────────────────────────────────────
  checked_at        timestamptz NOT NULL DEFAULT now(),

  -- ── gcube 원본 파싱 결과 ─────────────────────────────────────
  gcube_label       text        NULL,
  -- 예: 'TIER1 B200 x 1 / 180GB NVLink / ...'
  gcube_model       text        NULL,
  -- 파싱된 모델명. 예: 'B200', 'H100 SXM5'
  gcube_gpu_count   int         NULL CHECK (gcube_gpu_count IS NULL OR gcube_gpu_count > 0),
  -- 파싱된 GPU 장수
  gcube_low_krw     numeric     NULL CHECK (gcube_low_krw IS NULL OR gcube_low_krw >= 0),
  -- 가격 범위 하한 (원화)
  gcube_high_krw    numeric     NULL CHECK (gcube_high_krw IS NULL OR gcube_high_krw >= 0),
  -- 가격 범위 상한 (원화). low > high 이면 파서 버그 → note에 기록

  -- ── 우리 판매가 스냅샷 ────────────────────────────────────────
  our_price_krw     numeric     NULL CHECK (our_price_krw IS NULL OR our_price_krw >= 0),
  -- 수집 시점의 strategic_price_krw (또는 자동마진가). NULL = our_unset

  -- ── 비교 결과 ────────────────────────────────────────────────
  status            text        NOT NULL
    CHECK (status IN ('match', 'mismatch', 'not_found', 'our_unset')),

  -- ── 부가 설명 ────────────────────────────────────────────────
  note              text        NULL
  -- 파서 경고, 매칭 근거, 이상 사유 등 자유 텍스트
);

COMMENT ON TABLE gcube_price_checks IS
  'gcube.ai 실게시가를 매일 수집해 우리 판매가와 비교한 이력. append-only.';

COMMENT ON COLUMN gcube_price_checks.product_id IS
  'gpu_products.id 매칭. NULL = gcube에만 있고 우리 상품에 미매칭.';
COMMENT ON COLUMN gcube_price_checks.gcube_label IS
  'gcube 페이지 원본 라벨. 파서 디버그용 원문 보존.';
COMMENT ON COLUMN gcube_price_checks.gcube_low_krw IS
  'gcube 파싱 가격 범위 하한(KRW). 단일가이면 low=high.';
COMMENT ON COLUMN gcube_price_checks.gcube_high_krw IS
  'gcube 파싱 가격 범위 상한(KRW). 단일가이면 low=high.';
COMMENT ON COLUMN gcube_price_checks.our_price_krw IS
  '수집 시점 우리 판매가 스냅샷(strategic_price_krw 우선, NULL이면 자동마진가).';
COMMENT ON COLUMN gcube_price_checks.status IS
  'match=범위내 | mismatch=범위밖 | not_found=우리상품없음 | our_unset=우리가미설정';

-- ── 인덱스 ──────────────────────────────────────────────────────────────────
-- 1) 상품별 최신 이력 조회 (콕핏 상세 드릴다운, cursor 페이지네이션)
CREATE INDEX IF NOT EXISTS idx_gcube_checks_product_time
  ON gcube_price_checks (product_id, checked_at DESC)
  WHERE product_id IS NOT NULL;

-- 2) 전체 최신 수집 목록 (대시보드 타임라인, cursor 페이지네이션)
CREATE INDEX IF NOT EXISTS idx_gcube_checks_time
  ON gcube_price_checks (checked_at DESC, id);

-- 3) 상태별 필터 (콕핏 "mismatch만 보기" 등)
CREATE INDEX IF NOT EXISTS idx_gcube_checks_status_time
  ON gcube_price_checks (status, checked_at DESC);


-- ============================================================================
-- STEP 2: gcube_price_checks RLS
-- ============================================================================
-- 패턴: 024_gpu_pricing.sql 동일
--   authenticated → 읽기 허용 (콕핏 로그인 사용자)
--   service_role  → 전체 쓰기 허용 (파서 워커)

ALTER TABLE gcube_price_checks ENABLE ROW LEVEL SECURITY;

-- 읽기: 로그인 사용자 전체 허용 (024 패턴: USING (true) + TO authenticated)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'gcube_price_checks'
      AND policyname = 'all: read gcube_price_checks'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "all: read gcube_price_checks"
        ON gcube_price_checks
        FOR SELECT
        USING (true)
    $pol$;
  END IF;
END $$;

-- 쓰기: service_role 전용 (파서 워커가 service key 사용)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'gcube_price_checks'
      AND policyname = 'service: write gcube_price_checks'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "service: write gcube_price_checks"
        ON gcube_price_checks
        FOR ALL
        USING (auth.role() = 'service_role')
    $pol$;
  END IF;
END $$;


-- ============================================================================
-- STEP 3: gpu_products — gcube 캐시 컬럼 4개 추가 (IF NOT EXISTS — 멱등)
-- ============================================================================
-- 목적: 콕핏 목록 화면이 N+1 없이 gcube 상태를 즉시 표시하기 위한 캐시 레이어.
-- 이력 소스는 gcube_price_checks; 이 컬럼은 파서 워커가 최신 결과로 덮어씀.
--
-- gcube_last_status        : 최신 비교 결과 ('match'|'mismatch'|'not_found'|'our_unset')
-- gcube_last_checked_at    : 마지막 수집 시각
-- gcube_last_low_krw       : 마지막 수집 gcube 가격 하한
-- gcube_last_high_krw      : 마지막 수집 gcube 가격 상한

ALTER TABLE gpu_products
  ADD COLUMN IF NOT EXISTS gcube_last_status      text        NULL,
  ADD COLUMN IF NOT EXISTS gcube_last_checked_at  timestamptz NULL,
  ADD COLUMN IF NOT EXISTS gcube_last_low_krw     numeric     NULL,
  ADD COLUMN IF NOT EXISTS gcube_last_high_krw    numeric     NULL;

-- gcube_last_status에 유효값 제약 (NULL 허용 — 아직 수집 안 된 상품)
-- pg_constraint 가드: 이름 충돌 방지
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'gpu_products'::regclass
      AND conname = 'gpu_products_gcube_last_status_check'
  ) THEN
    ALTER TABLE gpu_products
      ADD CONSTRAINT gpu_products_gcube_last_status_check
        CHECK (gcube_last_status IS NULL
               OR gcube_last_status IN ('match', 'mismatch', 'not_found', 'our_unset'));
  END IF;
END $$;

COMMENT ON COLUMN gpu_products.gcube_last_status IS
  'gcube 가격 비교 최신 결과 캐시. 파서 워커가 gcube_price_checks 삽입 후 갱신.';
COMMENT ON COLUMN gpu_products.gcube_last_checked_at IS
  '마지막 gcube 수집 시각 캐시. 콕핏 목록 "최종확인" 표시용.';
COMMENT ON COLUMN gpu_products.gcube_last_low_krw IS
  'gcube 최신 가격 하한 캐시 (KRW). 콕핏 빠른 표시용.';
COMMENT ON COLUMN gpu_products.gcube_last_high_krw IS
  'gcube 최신 가격 상한 캐시 (KRW). 콕핏 빠른 표시용.';

-- gcube 상태별 콕핏 필터 인덱스 (mismatch 우선 표시 등)
CREATE INDEX IF NOT EXISTS idx_gpu_products_gcube_status
  ON gpu_products (gcube_last_status, gcube_last_checked_at DESC)
  WHERE gcube_last_status IS NOT NULL;


-- ============================================================================
-- STEP 4: gpu_audit_logs action_type CHECK 확장
-- ============================================================================
-- 신규 이벤트: 'gcube_price_collected' — 일별 파서 워커 실행 기록용
-- 기존 허용값 전부 유지 (080 패턴 동일: DROP IF EXISTS + ADD)

ALTER TABLE gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
ALTER TABLE gpu_audit_logs ADD CONSTRAINT gpu_audit_logs_action_type_check
  CHECK (action_type = ANY (ARRAY[
    -- 078 원본 허용값
    'quote_registered', 'quote_confirmed', 'lowest_changed', 'expired',
    'direct_set', 'margin_changed', 'rejected',
    'review_created', 'review_finalized', 'review_rejected', 'review_recheck_completed',
    'pool_stock_changed', 'availability_registered', 'inquiry_sent',
    'nonstandard_backfill',
    -- 079 추가값
    'quote_supplier_assigned', 'quote_edited', 'quote_deleted',
    'product_created', 'product_updated', 'product_deleted',
    'direct_price_updated', 'direct_price_deleted',
    'market_price_updated', 'market_price_deleted',
    'availability_deleted', 'pool_stock_deleted',
    -- 080 추가값
    'strategic_price_set',
    -- 081 신규: gcube 가격 수집 이벤트
    'gcube_price_collected'
  ]));


COMMIT;


-- ============================================================================
-- 롤백 스크립트 (필요 시 별도 실행 — 이 파일에 포함하지 말 것)
-- ============================================================================
-- BEGIN;
--
-- -- STEP 4: action_type CHECK를 080 상태로 복원
-- ALTER TABLE gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
-- ALTER TABLE gpu_audit_logs ADD CONSTRAINT gpu_audit_logs_action_type_check
--   CHECK (action_type = ANY (ARRAY[
--     'quote_registered', 'quote_confirmed', 'lowest_changed', 'expired',
--     'direct_set', 'margin_changed', 'rejected',
--     'review_created', 'review_finalized', 'review_rejected', 'review_recheck_completed',
--     'pool_stock_changed', 'availability_registered', 'inquiry_sent',
--     'nonstandard_backfill',
--     'quote_supplier_assigned', 'quote_edited', 'quote_deleted',
--     'product_created', 'product_updated', 'product_deleted',
--     'direct_price_updated', 'direct_price_deleted',
--     'market_price_updated', 'market_price_deleted',
--     'availability_deleted', 'pool_stock_deleted',
--     'strategic_price_set'
--   ]));
--
-- -- STEP 3: 캐시 컬럼 제약 + 인덱스 + 컬럼 제거
-- DROP INDEX IF EXISTS idx_gpu_products_gcube_status;
-- ALTER TABLE gpu_products DROP CONSTRAINT IF EXISTS gpu_products_gcube_last_status_check;
-- ALTER TABLE gpu_products DROP COLUMN IF EXISTS gcube_last_high_krw;
-- ALTER TABLE gpu_products DROP COLUMN IF EXISTS gcube_last_low_krw;
-- ALTER TABLE gpu_products DROP COLUMN IF EXISTS gcube_last_checked_at;
-- ALTER TABLE gpu_products DROP COLUMN IF EXISTS gcube_last_status;
--
-- -- STEP 2: RLS 정책 제거
-- DROP POLICY IF EXISTS "service: write gcube_price_checks" ON gcube_price_checks;
-- DROP POLICY IF EXISTS "all: read gcube_price_checks" ON gcube_price_checks;
--
-- -- STEP 1: 이력 테이블 제거 (데이터 포함 삭제 — 주의)
-- DROP TABLE IF EXISTS gcube_price_checks;
--
-- COMMIT;
