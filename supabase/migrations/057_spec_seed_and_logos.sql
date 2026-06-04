-- 057: ① gpu_specs에 기존 화면 데이터(VRAM) 시드 + ② 공급사 로고 URL 자동 수집
-- 화면에 이미 표시되던 스펙 데이터를 spec 레코드에 반영(빈 스펙 방지). 로고는 도메인 기반.

-- ① 기존 gpu_products 메모리(VRAM)로 gpu_specs 시드 (모델별 최소 구성 = 카드당 VRAM)
INSERT INTO gpu_specs (model_name, vram_gb, ai_generated)
SELECT model_name,
       ROUND((regexp_replace(memory, '[^0-9]', '', 'g'))::numeric / GREATEST(gpu_count, 1))::int AS vram_gb,
       false
FROM (
  SELECT DISTINCT ON (model_name) model_name, memory, gpu_count
  FROM gpu_products
  WHERE memory IS NOT NULL AND memory ~ '[0-9]'
  ORDER BY model_name, gpu_count ASC
) x
ON CONFLICT (model_name) DO NOTHING;

-- ② 로고 URL 컬럼 + 도메인 기반 백필 (Clearbit 로고 — 키 불요, UI에서 실패 시 글자 폴백)
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE accounts  ADD COLUMN IF NOT EXISTS logo_url text;

-- Google favicon 서비스(키 불요, 안정적 — Clearbit 빈 응답 회피). 사이트 파비콘=로고마크.
UPDATE suppliers
SET logo_url = 'https://www.google.com/s2/favicons?sz=128&domain=' || regexp_replace(website, '^https?://(www\.)?([^/]+).*$', '\2')
WHERE website IS NOT NULL AND website ~ '^https?://' AND logo_url IS NULL;

UPDATE accounts a
SET logo_url = s.logo_url
FROM suppliers s
WHERE s.account_id = a.id AND a.logo_url IS NULL AND s.logo_url IS NOT NULL;
