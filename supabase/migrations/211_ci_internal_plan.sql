-- 211_ci_internal_plan.sql — 사내 운영 플랜 (관심 채널 한도 없음)
--
-- 왜 필요한가:
-- 마이그 190이 SaaS 판매를 염두에 두고 '무료 체험' 플랜 하나만 심었다
-- (tracked_channels 3 · ai_calls_per_day 20 · members 1). 사내에서 쓰는 워크스페이스가
-- 그 플랜에 묶여 있어서, 4번째 채널을 등록하려 하면 사용자가 설정한 적 없는
-- "현재 플랜에서는 관심 채널을 3곳까지 지켜볼 수 있습니다" 벽이 떴다.
--
-- '무료 체험' 정의는 **그대로 둔다** — 나중에 실제로 판매할 때 필요하다.
-- 대신 한도 없는 사내 플랜을 만들고 우리 워크스페이스를 거기로 옮긴다.
-- (되돌리려면 구독의 plan_id를 free로 되돌리면 된다)
--
-- tracked_channels 를 null 로 두는 것이 "한도 없음"이다 —
-- 값을 빼면 코드가 무료 기본값 3으로 떨어졌기 때문에, 무제한을 표현할 방법이 없었다.

insert into ci_plans (code, name, limits, price_krw) values
  ('internal', '사내 운영',
   '{"tracked_channels":null,"ai_calls_per_day":null,"snapshot_preset":"standard","members":null,"refresh_per_day":null}',
   0)
on conflict (code) do update
  set name = excluded.name, limits = excluded.limits;

-- 기존 워크스페이스를 사내 플랜으로. 구독이 없으면 만든다.
insert into ci_subscriptions (workspace_id, plan_id)
select w.id, p.id from ci_workspaces w cross join ci_plans p where p.code = 'internal'
on conflict (workspace_id) do update set plan_id = excluded.plan_id;

comment on table ci_plans is
  '요금제 정의. limits의 값이 null이면 그 항목에 한도가 없다는 뜻이다(키를 빼는 것과 다르다).';
