-- 266_ai_call_key_ref.sql — 어느 키로 나갔는지 원장에 남긴다
--
-- 왜: 264 로 공급자마다 키를 여러 개 두게 됐다. 그런데 원장(ai_llm_calls)은
--   「어느 공급자, 어느 모델」까지만 적는다. 키가 셋인데 그중 하나가 한도를 다 쓰면
--   그것이 어느 키였는지 말할 방법이 없다 — 관리자 화면은 지금 상태만 보여 주고,
--   「어제 무엇이 그 키를 다 썼나」는 원장에만 있다.
--
-- 무엇을 적나: **사람이 붙인 이름**(ai_provider_keys.label)이다.
--   원문 키도 그 조각도 적지 않는다. 원장은 오래 남고 여러 사람이 읽는다.
--   이름이면 「둘째 키가 어제 한도를 다 썼다」를 말할 수 있고 그것이 필요한 전부다.
--
-- 왜 FK 를 안 거나: 키 줄은 지워진다. 지운 뒤에도 그때 무엇이 나갔는지는 남아야 한다.
--   FK 를 걸면 삭제가 막히거나(RESTRICT) 기록이 따라 지워진다(CASCADE) — 둘 다 원장이 아니다.
--
-- 보안 (LOOP.md 7절)
--   표를 새로 만들지 않는다. 기존 표에 칸 하나를 더할 뿐이라 그 표의 RLS 와 권한은 그대로다.
--   새 창구도 새 정책도 없다.
--
-- 되돌리기:
--   alter table public.ai_llm_calls drop column if exists key_ref;

ALTER TABLE public.ai_llm_calls
  ADD COLUMN IF NOT EXISTS key_ref text;

COMMENT ON COLUMN public.ai_llm_calls.key_ref IS
  '어느 키로 나갔나. ai_provider_keys.label 과 같은 사람이 붙인 이름이고 원문 키가 아니다. FK 를 걸지 않는다 — 키를 지워도 그때의 기록은 남아야 한다';
