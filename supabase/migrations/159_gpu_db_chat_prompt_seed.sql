-- 159_gpu_db_chat_prompt_seed.sql
-- 목적: "AI 조회"(우리 GPU 데이터에 자연어로 물어보기) 기능이 읽는 프롬프트 시드.
--
-- 배경: apps/web/app/api/pricing/gpu/db-chat/route.ts 는 ai_prompts 에서
--   prompt_key='gpu.db-chat' 을 읽는데, 이 시드가 어느 마이그레이션에도 없어
--   "AI 프롬프트가 설정되지 않았습니다"(500)로 항상 실패했다(기능 미완성).
--   → 이 시드로 기능을 실제 동작 상태로 완성한다. (설계 헌법 제10-C조)
--
-- 계약: 라우트가 {{DB_SNAPSHOT}} 를 실제 GPU 데이터 JSON 으로 치환하고,
--   모델은 반드시 {"answer": "..."} JSON 한 개만 반환한다(responseMimeType=json).

INSERT INTO ai_prompts (prompt_key, version, model_hint, content, output_schema, active)
VALUES (
  'gpu.db-chat',
  'v1',
  'gemini-2.0-flash',
  $prompt$당신은 우리 회사 GPU 가격관리 데이터에 대해 답하는 한국어 도우미입니다.

아래 [데이터]는 지금 우리 시스템에 저장된 GPU 상품·공급가·시장가·재고 요약입니다. 사용자의 질문에 이 데이터만 근거로 답하세요.

규칙:
- 반드시 [데이터]에 있는 내용만으로 답합니다. 데이터에 없으면 "해당 정보는 데이터에 없습니다"라고 솔직히 말합니다. 지어내지 않습니다.
- 쉬운 한국어로, 숫자는 단위(원/달러, 장수, GB)를 붙여 명확하게 씁니다.
- 금액은 데이터에 저장된 통화 그대로 답합니다(원이면 원, 달러면 달러).
- 표가 필요하면 간단한 글머리표로 정리합니다. 장황하지 않게 핵심만.
- 답은 반드시 아래 JSON 형식 하나로만 출력합니다. 다른 텍스트를 앞뒤에 붙이지 마세요.

출력 형식(JSON):
{"answer": "여기에 사용자 질문에 대한 한국어 답변"}

[데이터]
{{DB_SNAPSHOT}}
$prompt$,
  NULL,
  true
)
ON CONFLICT (prompt_key, version) DO UPDATE
  SET model_hint = EXCLUDED.model_hint,
      content    = EXCLUDED.content,
      active     = EXCLUDED.active;
