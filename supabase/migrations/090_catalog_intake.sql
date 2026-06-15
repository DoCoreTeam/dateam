-- 090: 카탈로그 파일(xlsx/csv) AI 자동 흡수 — 검토대기 게이트 확장
--  목적: 임의 카탈로그를 AI 헤더매핑 → 대량변환 → review_items 적재 → 승인 시 competitors+market_prices 반영.
--  기존 supplier 경로 무수정 보존. 멱등(IF NOT EXISTS / DROP-ADD).

-- 1) review_items.target — 검토대기 항목의 적재 대상(공급가 vs 경쟁사 시장가)
--    기존 행은 전부 'supplier'(기본값)로 안전 백필.
ALTER TABLE review_items
  ADD COLUMN IF NOT EXISTS target text NOT NULL DEFAULT 'supplier'
  CHECK (target IN ('supplier', 'competitor'));

-- 2) channel CHECK에 'catalog' 추가 (카탈로그 파일 유래) — 기존 채널 전부 보존
ALTER TABLE review_items DROP CONSTRAINT IF EXISTS review_items_channel_check;
ALTER TABLE review_items ADD CONSTRAINT review_items_channel_check
  CHECK (channel = ANY (ARRAY['mail', 'msg', 'pdf', 'img', 'own', 'market_link', 'catalog']));

-- 3) AI 헤더 매핑 프롬프트 seed (gpu.catalog-map)
--    헤더 + 샘플행 + 우리 스키마 → 컬럼→필드 매핑 JSON 1회 생성. 전행 변환은 코드가 결정적으로 수행.
INSERT INTO ai_prompts (prompt_key, version, model_hint, content, output_schema, active)
VALUES (
  'gpu.catalog-map',
  'v1',
  'gemini-2.0-flash',
  E'당신은 임의 구조의 GPU 클라우드 카탈로그 표를 우리 DB 스키마에 매핑하는 전문가입니다.\n주어진 [헤더 목록]과 [샘플 행]을 보고, 각 우리 필드에 대응하는 원본 컬럼명을 찾아 JSON으로 반환하세요.\n전체 행을 변환하지 마세요 — 컬럼 매핑만 1회 판단합니다. 변환은 코드가 합니다.\n\n## 우리 목표 필드 (경쟁사 시장가)\n- competitor_name: 공급/서비스 업체명이 들어있는 컬럼. 흔히 location/region/vendor 컬럼에 "업체/지역" 복합("spheron-ai/CANADA-1")으로 들어있음 — 그 컬럼명을 지정하고 _location_split=true로 표시.\n- model_name: GPU 모델명 컬럼 (예 gpu_name, model, gpu).\n- memory: GPU VRAM 컬럼 (예 gpu_memory, vram). 주의: 시스템 RAM(memory, ram) 과 혼동 금지 — VRAM 컬럼만.\n- price_usd: 가격 컬럼 (예 price, hourly, cost).\n- pricing_model: on-demand/spot 구분 컬럼 (예 spot 불리언). 없으면 null.\n\n## 메타 판단\n- _location_split: competitor_name 컬럼이 "업체/지역" 복합이면 true (코드가 / 앞을 업체로 분리).\n- _unit: 가격 단위 추정 ("per_hour"|"per_month"|"unknown"). 시간당이 명백하면 per_hour.\n- _currency: 통화 추정 ("USD"|"KRW"|...). 불명확하면 "USD".\n- _confidence: 매핑 전체 신뢰도 0~100 정수.\n\n## 출력 (순수 JSON, 설명·코드펜스 없이)\n{"competitor_name":"location","model_name":"gpu_name","memory":"gpu_memory","price_usd":"price","pricing_model":"spot","_location_split":true,"_unit":"per_hour","_currency":"USD","_confidence":92}\n\n대응 컬럼이 없으면 해당 필드는 null. competitor_name/model_name/price_usd 중 하나라도 못 찾으면 _confidence를 50 미만으로.',
  '{"type":"object","required":["competitor_name","model_name","price_usd"]}',
  true
)
ON CONFLICT (prompt_key, version) DO UPDATE
  SET content = EXCLUDED.content,
      model_hint = EXCLUDED.model_hint,
      output_schema = EXCLUDED.output_schema,
      active = true;
