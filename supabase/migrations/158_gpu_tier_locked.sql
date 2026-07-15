-- 158_gpu_tier_locked.sql
-- 목적: "사람이 정한 등급(tier)은 자동판정이 다시 덮지 않는다" (설계 헌법 제5·1조)
--
-- 배경: gpu_products.tier 는 누구나 덮어쓸 수 있는 평값이었다. RTX 4090 처럼
--   모델명 정규식상 무조건 T3 로 분류되는 모델은, 사람이 수동으로 T2 를 지정해도
--   재판정/재등록이 돌면 자동값(T3)으로 되돌아갈 수 있었다("티어 바꿔도 적용 안 됨"의 뿌리).
--   → tier_locked 플래그로 "사람이 손댄 등급"을 표시하고, 자동판정은 이 값을 존중한다.
--
-- 안전: ADD(기본 false) → 백필(자동판정과 다른 값=사람이 바꾼 것으로 간주해 잠금) → 검증.
--   기존 tier 값은 절대 변경하지 않는다(플래그만 채운다).

-- 1) 컬럼 추가 (기본 false)
ALTER TABLE gpu_products
  ADD COLUMN IF NOT EXISTS tier_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN gpu_products.tier_locked IS
  '사람이 등급(tier)을 수동 지정했으면 true. 자동판정(infer_tier)은 이 값이 true면 덮어쓰지 않는다. (설계 헌법 제5·1조)';

-- 2) 백필: 현재 tier 가 자동판정값과 다르면 = 사람이 의도적으로 바꾼 것 → 잠금
--    (infer_tier 는 059_data_integrity_cleanup.sql 에서 정의된 모델명 기반 판정 함수)
UPDATE gpu_products
SET tier_locked = true
WHERE deleted_at IS NULL
  AND tier IS DISTINCT FROM infer_tier(model_name);

-- 3) 인덱스(자동 수집/재판정 배치가 "잠기지 않은 것만" 훑을 때 사용)
CREATE INDEX IF NOT EXISTS idx_gpu_products_tier_locked
  ON gpu_products (tier_locked) WHERE deleted_at IS NULL;
