-- 180: GPU 가격표 큐레이션 — 노출 제어(취급 여부) 컬럼 신설
--
-- 배경: gpu_products는 지금까지 `deleted_at IS NULL`인 전량(99행)을 가격표에 노출했다.
--   "우리가 취급하는지"를 나타내는 컬럼이 없어 TESLA(K80/P100 등 구형)·미취급 모델까지 전부 노출됨.
--   (docs/2026-07-26-v0.7.405-gpu-pricetable-curation)
--
-- 설계(비파괴·가역):
--   - is_active   : 가격표 기본 노출 여부. 삭제(deleted_at)와 별개 — 데이터는 유지하고 "표시만" 끈다.
--   - needs_review: 신규 유입 모델의 "검토 대기" 표식. 신규는 숨김+배지 → admin 확정 후 해제.
--   ⚠️ 노출 필터는 **표시 계층(콕핏 가격표)에서만** 적용한다. getGpuCatalog(SSOT)·시세수집·경쟁사 매칭
--      경로는 전량 유지(필터 미적용) — 숨긴 모델의 시장 관측이 끊기면 깡통/중복 재생성 사고(v0.7.264) 재발.
--
-- 신규 행 기본값: is_active=false(숨김) + needs_review=true(검토 배지) — 견적서 자동추출 등으로 유입된
--   신모델이 조용히 노출되거나 조용히 묻히지 않게. (사용자 확정 2026-07-26)

ALTER TABLE gpu_products ADD COLUMN IF NOT EXISTS is_active    boolean NOT NULL DEFAULT false;
ALTER TABLE gpu_products ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT true;

-- ── 기존 행 시드(1회성 — 이후 admin이 관리 UI에서 자유 조정) ──
-- 1) 기존 행은 모두 "검토 완료" 베이스라인으로 — 신규 유입만 검토 배지가 뜨도록.
UPDATE gpu_products SET needs_review = false WHERE needs_review = true;

-- 2) 취급 시드: 판매가(strategic_price_krw)가 설정됐거나, 레거시 계열(Tesla·Quadro)이 "아닌" 모델을 ON.
--    · 견적(supply_quotes)은 거의 전 모델에 존재해 "취급" 신호로 부적합(TESLA도 과거 견적 보유) → 사용
--      하지 않는다.
--    · 레거시 2계열(Tesla=구형 데이터센터, Quadro=구세대 워크스테이션)만 OFF. 임의 모델 하드코딩이 아니라
--      "계열 프리픽스" 기준 → 방어 가능. TESLA 10행·Quadro RTX 6000이 기본 숨김이 된다.
--    · admin은 관리 UI(스펙관리)에서 이 시드를 언제든 토글로 조정. "시스템 고정" 아님(사용자 요청).
UPDATE gpu_products
SET is_active = true
WHERE deleted_at IS NULL
  AND (
    COALESCE(strategic_price_krw, 0) > 0
    OR model_name !~* '^(tesla|quadro)\s'
  );

-- 노출 필터 인덱스(활성 행만 부분 인덱스).
CREATE INDEX IF NOT EXISTS idx_gpu_products_active
  ON gpu_products (is_active)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN gpu_products.is_active    IS '가격표 기본 노출 여부(취급 모델). deleted_at와 별개 — 표시 계층에서만 필터. false=숨김.';
COMMENT ON COLUMN gpu_products.needs_review IS '신규 유입 모델 검토 대기 표식. 신규=true(숨김+배지), admin 확정 시 false.';

-- ── 감사 action_type CHECK 확장 — 노출 토글(admin) 이벤트 기록용 ──
-- (부분 추가 불가 → 179 전체 보존 + 'product_visibility_changed' 1개 추가)
ALTER TABLE gpu_audit_logs DROP CONSTRAINT IF EXISTS gpu_audit_logs_action_type_check;
ALTER TABLE gpu_audit_logs ADD CONSTRAINT gpu_audit_logs_action_type_check
  CHECK (action_type = ANY (ARRAY[
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
    'strategic_price_set',
    'gcube_price_collected',
    'market_cost_ingested',
    'gcube_reflected',
    'quote_selected', 'quote_deselected',
    'review_bulk_confirmed', 'review_bulk_deleted',
    'product_restored',
    'competitor_merged',
    -- 180 신규: 가격표 노출 토글(취급 여부·검토 확정)
    'product_visibility_changed'
  ]));
