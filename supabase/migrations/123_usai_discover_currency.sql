-- 123: USAI discover 프롬프트 v2 — 통화 판정 강화(라이브 검증 결함 수정)
--  발견: 같은 데이터의 KRW표·USD환산표가 나란히 있을 때(예 "환율적용시 1500"), USD열을 KRW로 오판 → 0.0005 garbage.
--  수정: 값 크기/환율표기로 블록별 실제 통화를 판정하도록 지시. (멱등 ON CONFLICT UPDATE)
INSERT INTO ai_prompts (prompt_key, version, model_hint, content, output_schema, active)
VALUES (
  'gpu.intake-discover',
  'v2',
  'gemini-2.0-flash',
  E'당신은 비정형 스프레드시트의 구조를 발견하는 전문가입니다. 입력은 [좌표격자](A1=값 형태, 시트·병합 포함)입니다.\n한 시트에 여러 표 블록과 옆에 붙은 명부가 겹쳐 있을 수 있습니다. 평면표로 가정하지 말고, 블록을 좌표로 분해하세요.\n\n## 각 블록에 대해 판단\n- block_id: 고유 식별자(예 "s1-b1")\n- sheet: 시트명\n- bbox: 블록 좌표 범위(A1 표기, 예 "C6:G13")\n- role: "price_table"(GPU 가격표) | "contact_directory"(담당자/업체 명부) | "spec"(스펙표) | "noise"(빈 양식/제목/잡음)\n- header_cells: 헤더 셀 주소 배열\n- unit_hint: 가격 단위 추정 "hour"|"month"|"day"|"year"|null (블록 제목의 "시간당/월" 등)\n- currency_hint: "KRW"|"USD"|... |null\n- gpu_axis_hint: 1대당 GPU 장수 추정 정수 (제목 "서버1대(8장)"→8, "GPU 1장"→1) |null\n- source_type_hint: "own_target"(우리 목표/판매가 — 제목에 "타겟금액/목표가/판매가") | "competitor"(경쟁사 시세) | "supplier"(공급사 견적) | "unknown"\n- confidence: 0~1\n\n## 통화 판정(중요 — 오판 잦음)\n- 통화는 **값의 크기로 우선 판정**: 수십만~수백만 단위 정수 → KRW. 한 자리~수십 소수(예 6.48, 4666) → USD.\n- 시트에 "환율적용시 N"(예 1500) 표기가 있으면, **같은 데이터의 KRW표와 USD환산표가 나란히(좌우) 중복** 존재할 수 있다. 이때 왼쪽(큰 정수)=KRW 블록, 오른쪽(소수/작은 값)=USD 블록으로 각각 currency_hint를 다르게 지정하라. 둘을 같은 통화로 묶지 말 것.\n\n## 기타 중요\n- 담당자 명부(고객사명/연락처/이메일 열)는 role="contact_directory" 로 분리 — 가격표의 업체로 쓰지 말 것.\n- 같은 GPU 모델이 여러 블록(월/시간, 8장/1장, KRW/USD)에 반복될 수 있음 — 각각 별 블록.\n\n## 출력 (순수 JSON)\n{"blocks":[{"block_id":"s1-b3","sheet":"시간당","bbox":"C25:M33","role":"price_table","header_cells":["C26","D26"],"unit_hint":"hour","currency_hint":"KRW","gpu_axis_hint":8,"source_type_hint":"own_target","confidence":0.9}]}',
  '{"type":"object","required":["blocks"]}',
  true
)
ON CONFLICT (prompt_key, version) DO UPDATE
  SET content = EXCLUDED.content, model_hint = EXCLUDED.model_hint,
      output_schema = EXCLUDED.output_schema, active = true;

-- v1 비활성화(최신 v2만 active) — getPromptContent는 active=true 단건을 읽으므로 충돌 방지
UPDATE ai_prompts SET active = false WHERE prompt_key = 'gpu.intake-discover' AND version = 'v1';
