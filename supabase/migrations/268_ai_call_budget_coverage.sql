-- 268: 상한 없는 창구를 없앤다 (P0030 I19)
--
-- 왜: 상한 표에 `crm` 한 줄이 있는데 원장에 남는 창구 이름은 `crm/quick_create` 였다.
-- 정확히 같은 이름만 찾던 탓에 그 상한이 **한 번도 안 걸렸다**. 재어 보니 그것만이 아니었다 —
-- 실측 2026-09-20: 창구 마흔하나 중 **서른둘이 상한이 아예 없었다.** 게이트는 상한을 모르면
-- 통과시키는 것이 설계라(관측 장치가 장애 원인이 되면 안 되므로) 그 서른둘은 무제한이었다.
--
-- 코드 쪽은 이름을 빗금 앞자리로 타고 올라가게 고쳤다(lib/ai/budget.ts budgetKeysFor).
-- 여기서는 **받아 주는 줄**을 심어, 표에 이름이 없는 창구도 상한에 닿게 한다.
--
-- 값의 근거: 원장이 나흘치뿐이라(마이그 253 이후) 서른넷은 관측이 0이다. 관측 없는 값을
-- 지어내지 않고, 사람이 눌러 쓰는 현실적 상한을 **기본값**으로 둔다. 관측이 쌓이면
-- 관리자 사용량 화면에서 창구별로 조인다 — 그 화면이 이번 판에 생겼다.
--
-- `do nothing` 인 이유: 이미 사람이 조여 둔 줄을 씨앗이 되돌리면, 조인 일이 배포마다 풀린다.

insert into ai_call_budget (feature, daily_limit, per_minute_limit, enabled) values
  -- 받아 주는 줄. 이 한 줄이 「이름이 표에 없으면 무제한」을 없앤다
  ('*', 100, 5, true),

  -- 사람이 눌러 시작하는 창구 — 한 사람이 하루에 누를 수 있는 현실적 상한
  ('meeting', 100, 3, true),          -- meeting/stt · meeting/transcribe
  ('daily', 100, 5, true),            -- daily/analyze-work · daily/memo-clusters
  ('deals', 100, 5, true),            -- deals/activities · deals/ai-parse
  ('leads', 50, 3, true),             -- leads/vision
  ('weekly-report', 50, 3, true),     -- weekly-report/generate
  ('rfp', 200, 5, true),              -- RFP 분석은 문서 하나에 여러 번 부른다

  -- 배경에서 도는 것 — 사람이 기다리지 않으므로 좁게 잡는다
  ('gpu-company-enrich', 30, 2, true)
on conflict (feature) do nothing;

comment on table ai_call_budget is
  '기능별 AI 호출 상한. 줄이 없으면 상한을 모르는 것이고, 그때는 막지 않는다. '
  '창구 이름은 빗금 앞자리로 올라가며 찾고 마지막에 ''*'' 가 받는다 (P0030 I07·I19)';
