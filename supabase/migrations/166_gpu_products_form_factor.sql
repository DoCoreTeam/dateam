-- 166_gpu_products_form_factor.sql
-- 목적: 폼팩터 축 분리(P5). gpu_products는 model_name·memory·gpu_count 3개 컬럼뿐이라
--   실제 축(모델·폼팩터·메모리·장수) 중 폼팩터가 model_name 문자열에 섞여 들어갔다
--   ("A100 SXM"·"H100 PCIe"·"B200 SXM6"·"H100 NVL"), 동시에 폼팩터 없는 "A100"·"H100"·"B200"도 공존.
--   경쟁사가 "A100 SXM4"·"H100 SXM5"·"GB200 SXM"처럼 세대숫자를 붙이면 문자열이 달라 매칭 실패 → 보류.
-- additive only — model_name은 절대 변경하지 않는다(하위호환). form_factor는 nullable 신규 컬럼.
-- 확정 기획: DC-DEV-DB P5 (GPU 카탈로그 폼팩터 축 분리)

ALTER TABLE gpu_products ADD COLUMN IF NOT EXISTS form_factor text;
COMMENT ON COLUMN gpu_products.form_factor IS
  '폼팩터 축(세대숫자 없는 계열값만: SXM/PCIe/NVL). model_name 문자열은 무변경 — 읽기 축으로만 추가. '
  'lib/gpu/form-factor.ts normalizeFormFactor()가 SSOT(세대숫자 흡수: SXM4/SXM5/SXM6→SXM).';

-- 값 도메인 가드(NOT VALID — 신규만 강제, 과거 무손상. 세대숫자 없는 계열값만 허용).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gpu_products_form_factor_chk' AND conrelid = 'gpu_products'::regclass
  ) THEN
    ALTER TABLE gpu_products ADD CONSTRAINT gpu_products_form_factor_chk
      CHECK (form_factor IS NULL OR form_factor IN ('SXM', 'PCIe', 'NVL')) NOT VALID;
  END IF;
END $$;

-- 백필: 기존 model_name 문자열에서 폼팩터 토큰만 추출해 form_factor에 채운다.
--   SXM6·SXM5·SXM4·SXM → 'SXM' / PCIe·PCIE → 'PCIe' / NVL → 'NVL' / 없으면 NULL(무변경).
--   model_name 자체는 이번 차수에서 손대지 않는다(읽기 축만 추가, 하위호환 보호).
-- 주의: Postgres POSIX ARE는 \b가 word boundary가 아니라 backspace 문자다. \y가 word boundary.
UPDATE gpu_products
SET form_factor = CASE
  WHEN model_name ~* '\ySXM[0-9]*\y' THEN 'SXM'
  WHEN model_name ~* '\yPCI-?E\y' THEN 'PCIe'
  WHEN model_name ~* '\yNVL\y' THEN 'NVL'
  ELSE NULL
END
WHERE form_factor IS NULL
  AND model_name ~* '\y(SXM[0-9]*|PCI-?E|NVL)\y';

-- 매칭에 쓰일 조합 인덱스 — (model_name, form_factor) 2축 조회(resolve-product.ts 폼팩터 폴백 경로).
CREATE INDEX IF NOT EXISTS idx_gpu_products_model_form_factor
  ON gpu_products (model_name, form_factor)
  WHERE deleted_at IS NULL;
