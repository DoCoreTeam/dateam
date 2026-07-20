-- 169_gpu_model_candidates.sql
-- 목적: 카탈로그에 없는 **실존 신규 모델**을 근거와 함께 남겨 등록 제안으로 잇는다.
--
-- 배경(실측 v0.7.365): verda GB300은 실제 NVIDIA 제품인데 카탈로그에 없어 held(no_model)로 보류됐다.
--   그런데 held 항목은 market_prices에 저장되지 않으므로 **관측 스펙도 함께 사라진다**.
--   화면은 "스펙관리에서 등록 후 재반영"이라 안내하지만, 정작 사람이 등록할 근거(원문 라벨·폼팩터·
--   메모리·출처 URL)가 아무 데도 남지 않아 맨손으로 다시 찾아야 했다.
--   → 보류를 "버림"이 아니라 "등록 대기"로 만든다. 자동 생성은 여전히 금지(깡통 방지) —
--     사람이 확인하고 승인하는 후보 큐다.
-- append/upsert only. gpu_products 무변경.

CREATE TABLE IF NOT EXISTS gpu_model_candidates (
  id             uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- 정규화 키(중복 관측 병합용) — 소문자·공백제거된 모델 core + 폼팩터
  candidate_key  text        NOT NULL UNIQUE,
  source_model   text        NOT NULL,            -- 원문 라벨 그대로("1x GB300 SXM6 288GB")
  model_core     text        NOT NULL,            -- 캐노니컬 core("GB300")
  form_factor    text,                            -- SXM|PCIe|NVL
  memory_gb      integer,
  competitor     text,                            -- 어디서 봤는지
  source_url     text,
  observed_count integer     NOT NULL DEFAULT 1,  -- 몇 번 관측됐는지(자주 보일수록 실존 가능성↑)
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  -- 사람 처리 상태
  status         text        NOT NULL DEFAULT 'pending',  -- pending|registered|rejected
  resolved_at    timestamptz,
  resolved_by    uuid
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gmc_status_chk' AND conrelid='gpu_model_candidates'::regclass) THEN
    ALTER TABLE gpu_model_candidates ADD CONSTRAINT gmc_status_chk
      CHECK (status IN ('pending','registered','rejected')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gmc_ff_chk' AND conrelid='gpu_model_candidates'::regclass) THEN
    ALTER TABLE gpu_model_candidates ADD CONSTRAINT gmc_ff_chk
      CHECK (form_factor IS NULL OR form_factor IN ('SXM','PCIe','NVL')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gmc_status ON gpu_model_candidates (status, last_seen_at DESC);

COMMENT ON TABLE gpu_model_candidates IS '카탈로그 미등록 모델 후보(등록 대기). 자동 생성 금지 정책은 유지 — 사람이 승인해 gpu_products로 옮긴다. 근거=원문 라벨·폼팩터·메모리·출처 URL.';

ALTER TABLE gpu_model_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth: read gmc" ON gpu_model_candidates;
CREATE POLICY "auth: read gmc" ON gpu_model_candidates FOR SELECT USING (auth.role() IN ('authenticated','service_role'));
DROP POLICY IF EXISTS "service: write gmc" ON gpu_model_candidates;
CREATE POLICY "service: write gmc" ON gpu_model_candidates FOR ALL USING (auth.role() = 'service_role');
