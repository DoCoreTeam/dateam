-- 055: GPU 상세 스펙(칩 데이터시트) — AI 자동 생성 + 사람 수정
-- 모델당 1행. 가격 계산(SSOT)과 무관한 순수 확장(additive) — 기존 동작 무영향.

CREATE TABLE IF NOT EXISTS gpu_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name text UNIQUE NOT NULL,
  -- 코어 사양
  architecture text,
  vram_gb integer,
  vram_type text,
  cuda_cores integer,
  tensor_cores integer,
  fp16_tflops numeric,
  bf16_tflops numeric,
  fp8_tflops numeric,
  -- 시스템/물리
  nvlink boolean,
  nvlink_bandwidth text,
  tdp_w integer,
  interface text,            -- PCIe / SXM
  mig_support boolean,
  release_year integer,
  datasheet_url text,
  notes text,
  -- 운영 메타
  ai_generated boolean NOT NULL DEFAULT false,
  ai_confidence integer,
  ai_model text,
  edited_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- SSD는 RTX 등에서 미제공 가능 → 선택값
ALTER TABLE gpu_products ALTER COLUMN storage_gb DROP NOT NULL;

-- RLS: 팀원 읽기, 쓰기는 service_role(adminClient) 전용 (기존 pricing 테이블 패턴)
ALTER TABLE gpu_specs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='gpu_specs' AND policyname='gpu_specs_select') THEN
    CREATE POLICY gpu_specs_select ON gpu_specs FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
