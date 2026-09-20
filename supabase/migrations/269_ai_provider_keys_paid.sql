-- 269_ai_provider_keys_paid.sql — 유료 키를 표시하고 나중에 쓴다
--
-- 왜: 지금 순서는 priority 하나로만 정해진다(264). 그래서 무료 키와 결제되는 키가
--   같은 줄에 섞여 있고, 관리자가 「무료부터 태우고 유료는 남겨 두기」를 표현할 길이 없다.
--   순서를 손으로 맞춰 둬도 무료 키가 한도에 걸려 쉬는 사이 그 자리가 밀려서
--   결국 유료 키가 아무 때나 불린다.
--
-- 왜 칼럼인가
--   키 문자열만 보고는 유료인지 알 길이 없다. 공급자가 그 사실을 응답에 담지 않고,
--   같은 프로젝트의 키가 결제를 붙이는 순간 유료가 된다. 사람이 표시하는 수밖에 없고,
--   표시는 그 키 줄에 붙어 있어야 한다 — 설정 한 곳에 모으면 키를 지울 때 같이 안 사라진다.
--
-- 왜 priority 로 대신하지 않나
--   유료 키를 맨 뒤로 밀어 두는 것으로 흉내 낼 수는 있다. 그런데 그 뒤에 무료 키를
--   하나 더 넣으면 그 새 키가 유료 뒤에 붙는다(새 줄은 맨 뒤에 붙는 것이 이 표의 규칙이다).
--   「유료는 언제나 나중」은 순서가 아니라 등급이라 따로 적는다.
--
-- 보안 (LOOP.md 7절 S1)
--   표를 만들지 않는다. 칼럼만 더하므로 264 에서 켠 RLS(ENABLE + FORCE)와
--   GRANT 판(anon·authenticated 회수, service_role 만 허용)이 그대로 남는다.
--   정책은 여전히 0개다 = 서비스롤 밖에서는 아무도 못 읽고 못 쓴다.
--   새로 저장하는 값은 boolean 하나이고 비밀이 아니다. 원문 키가 나가는 길은 바뀌지 않는다.
--
-- 되돌리기:
--   drop index if exists idx_ai_provider_keys_pick_paid;
--   alter table ai_provider_keys drop column if exists is_paid;
--   (인덱스 idx_ai_provider_keys_pick 은 그대로 남아 있어 옛 순서로 돌아온다)

ALTER TABLE public.ai_provider_keys
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;

-- 고르는 질의가 매 호출마다 돈다. 순서가 (등급, priority, id) 로 바뀌었으므로 인덱스도 같이
CREATE INDEX IF NOT EXISTS idx_ai_provider_keys_pick_paid
  ON public.ai_provider_keys (provider, is_paid, priority, id);

COMMENT ON COLUMN public.ai_provider_keys.is_paid IS
  '결제가 붙은 키인가. 참이면 무료 키가 모두 마른 뒤에만 부른다. 키 문자열로는 알 수 없어 사람이 표시한다';
