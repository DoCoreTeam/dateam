-- 122: USAI(통합 자가적응 흡수) — 분류 타깃 확장 + AI 프롬프트 seed
--  목적: 비정형 다중블록 파일을 AI 주도로 흡수. 우리 목표가/경쟁사가/공급사가를 AI가 분류.
--  기존 catalog(target competitor) 경로 보존. 멱등(DROP-ADD / ON CONFLICT).

-- 1) review_items.target 에 'own_target'(우리 목표/판매가) 추가
--    090에서 ('supplier','competitor')만 허용 → 우리 목표가가 competitor로 오분류되던 결함(F7) 차단.
ALTER TABLE review_items DROP CONSTRAINT IF EXISTS review_items_target_check;
ALTER TABLE review_items ADD CONSTRAINT review_items_target_check
  CHECK (target IN ('supplier', 'competitor', 'own_target'));

-- 2) Stage2 구조발견 프롬프트 (gpu.intake-discover)
--    좌표격자 → 블록 N개의 bbox·역할·헤더·단위/통화/장수 단서·분류 추정. 추출은 별 프롬프트가 블록별로.
INSERT INTO ai_prompts (prompt_key, version, model_hint, content, output_schema, active)
VALUES (
  'gpu.intake-discover',
  'v1',
  'gemini-2.0-flash',
  E'당신은 비정형 스프레드시트의 구조를 발견하는 전문가입니다. 입력은 [좌표격자](A1=값 형태, 시트·병합 포함)입니다.\n한 시트에 여러 표 블록과 옆에 붙은 명부가 겹쳐 있을 수 있습니다. 평면표로 가정하지 말고, 블록을 좌표로 분해하세요.\n\n## 각 블록에 대해 판단\n- block_id: 고유 식별자(예 "s1-b1")\n- sheet: 시트명\n- bbox: 블록 좌표 범위(A1 표기, 예 "C6:G13")\n- role: "price_table"(GPU 가격표) | "contact_directory"(담당자/업체 명부) | "spec"(스펙표) | "noise"(빈 양식/제목/잡음)\n- header_cells: 헤더 셀 주소 배열\n- unit_hint: 가격 단위 추정 "hour"|"month"|"day"|"year"|null (블록 제목의 "시간당/월" 등)\n- currency_hint: "KRW"|"USD"|... |null (금액 자릿수·기호·환율표기)\n- gpu_axis_hint: 1대당 GPU 장수 추정 정수 (제목 "서버1대(8장)"→8, "GPU 1장"→1) |null\n- source_type_hint: "own_target"(우리 목표/판매가 — 제목에 "타겟금액/목표가/판매가") | "competitor"(경쟁사 시세) | "supplier"(공급사 견적) | "unknown"\n- confidence: 0~1\n\n## 중요\n- 담당자 명부(고객사명/연락처/이메일 열)는 role="contact_directory" 로 분리 — 가격표의 업체로 쓰지 말 것.\n- 같은 GPU 모델이 여러 블록(월/시간, 8장/1장)에 반복될 수 있음 — 각각 별 블록.\n\n## 출력 (순수 JSON)\n{"blocks":[{"block_id":"s1-b3","sheet":"시간당","bbox":"C25:M33","role":"price_table","header_cells":["C26","D26"],"unit_hint":"hour","currency_hint":"KRW","gpu_axis_hint":8,"source_type_hint":"own_target","confidence":0.9}]}',
  '{"type":"object","required":["blocks"]}',
  true
)
ON CONFLICT (prompt_key, version) DO UPDATE
  SET content = EXCLUDED.content, model_hint = EXCLUDED.model_hint,
      output_schema = EXCLUDED.output_schema, active = true;

-- 3) Stage3 블록별 추출 프롬프트 (gpu.intake-extract-block)
--    price_table 블록 1개의 좌표격자 → 레코드들. 각 값에 출처 셀주소(provenance) 필수.
INSERT INTO ai_prompts (prompt_key, version, model_hint, content, output_schema, active)
VALUES (
  'gpu.intake-extract-block',
  'v1',
  'gemini-2.0-flash',
  E'당신은 GPU 가격표 블록 1개에서 레코드를 추출합니다. 입력은 해당 블록의 [좌표격자]와 블록 메타(unit/currency/gpu_axis/source_type 단서)입니다.\n블록의 각 (GPU 모델 × 요금제) 조합을 1개 레코드로 추출하세요.\n\n## 각 레코드 필드 (값마다 출처 셀주소 필수)\n- model_name: GPU 모델명 (예 "T4","A100 80GB")\n- model_addr: 모델명 셀 주소\n- price_raw: 가격 원시값(숫자/문자 그대로)\n- price_addr: 가격 셀 주소\n- currency_token: 통화 토큰(셀/헤더/블록단서, 예 "KRW","$") |null\n- unit_token: 단위 토큰("시간당","월","/hr") |null\n- gpu_count_hint: GPU 장수 정수 |null\n- term: 요금제("on_demand","reserved_1m"... 헤더의 on-demand/Reserved) |null\n- source_type: "own_target"|"competitor"|"supplier" (블록 단서 따름)\n- confidence: 0~1\n\n## 중요\n- 출처 주소(model_addr/price_addr)가 불명확하면 그 레코드는 건너뛰세요(추측 금지).\n- 빈 셀/소계/제목은 레코드로 만들지 마세요.\n\n## 출력 (순수 JSON)\n{"records":[{"model_name":"T4","model_addr":"C27","price_raw":9722.22,"price_addr":"D27","currency_token":"KRW","unit_token":"시간당","gpu_count_hint":8,"term":"on_demand","source_type":"own_target","confidence":0.9}]}',
  '{"type":"object","required":["records"]}',
  true
)
ON CONFLICT (prompt_key, version) DO UPDATE
  SET content = EXCLUDED.content, model_hint = EXCLUDED.model_hint,
      output_schema = EXCLUDED.output_schema, active = true;
