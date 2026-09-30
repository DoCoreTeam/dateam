-- 300 이상 조항 규칙 표가 조직을 둘 이상 들게 한다
--
-- ## 무엇이 잘못돼 있었나
--
-- `rfp_anomaly_rules` 의 기본키가 `id` 하나였다. 규칙 id 는 R01~R12 로 **고정된 이름**이라
-- R01 을 가질 수 있는 조직이 저장소 전체에 하나뿐이었다. 그런데 쓰기 정책은
-- `org_id is not null and rfp_is_admin(org_id)` 라 조직을 반드시 요구한다.
-- 둘을 합치면: **둘째 조직은 규칙을 영영 저장할 수 없다.**
--
-- 실측 2026-09-30: 조직 1개(데이터얼라이언스 AX사업본부), 규칙 12행, rfp_anomalies 0행.
-- 지금은 안 터진다. 둘째 조직이 생기는 날 터지고, 그때 증상은 「저장 단추를 눌러도
-- 아무 일도 안 일어난다」로 나온다 — 원인이 기본키라는 것을 아무도 못 찾는다.
--
-- ## org_id 를 NOT NULL 로 올리는 것이 곧 보안이다
--
-- 읽기 정책 `rfp_anomaly_rules_read` 에 `org_id is null` 갈래가 있었다.
-- org_id 를 비운 줄은 **조직을 안 가리고 읽힌다.** 기본키에 org_id 가 들어가면
-- 그 칸은 NOT NULL 이어야 하므로 그런 줄을 애초에 만들 수 없게 된다.
-- 그래서 정책에서도 그 갈래를 뗀다 — 남겨 두면 「언젠가 쓰라는 뜻」으로 읽힌다.
-- 지금 org_id 가 빈 줄은 0행이라 옮길 데이터가 없다.
--
-- ## 외래키를 왜 (org_id, rule_id) 로 바꾸나
--
-- 가리키는 쪽 키가 두 칸이 되면 가리키는 외래키도 두 칸이어야 한다.
-- `rfp_anomalies` 는 `org_id` 를 NOT NULL 로 이미 들고 있어 그대로 쓸 수 있다.
--
-- `on delete set null (rule_id)` 로 칸을 집어 준다. 그냥 `set null` 이면 org_id 까지
-- 비우려 들고, 그 칸은 NOT NULL 이라 **규칙 삭제가 통째로 실패한다.**
-- (칸을 고르는 문법은 PostgreSQL 15 부터, 이 저장소는 17.6)
--
-- rule_id 는 NULL 을 받는다. AI 만 잡은 조항은 규칙이 없다 —
-- 기본 MATCH SIMPLE 이라 한 칸이라도 NULL 이면 외래키를 안 본다.
--
-- ## 표를 새로 만들지 않는다
--
-- 247 이 만든 표를 그대로 쓴다. RLS 는 그때 켰고 여기서 끄지 않는다(끝에서 다시 확인한다).
-- 사본(CREATE TABLE AS)을 뜨지 않는다 — 사본은 원본의 RLS 를 안 물려받는다.

begin;

-- 외래키를 먼저 떼야 기본키를 바꿀 수 있다
alter table rfp_anomalies drop constraint if exists rfp_anomalies_rule_id_fkey;

alter table rfp_anomaly_rules drop constraint rfp_anomaly_rules_pkey;
alter table rfp_anomaly_rules alter column org_id set not null;
alter table rfp_anomaly_rules add constraint rfp_anomaly_rules_pkey primary key (org_id, id);

alter table rfp_anomalies
  add constraint rfp_anomalies_rule_id_fkey
  foreign key (org_id, rule_id) references rfp_anomaly_rules (org_id, id)
  on delete set null (rule_id);

-- 죽은 갈래를 뗀다. org_id 가 NOT NULL 이 된 뒤로 `org_id is null` 은 참이 될 수 없다
drop policy if exists rfp_anomaly_rules_read on rfp_anomaly_rules;
create policy rfp_anomaly_rules_read on rfp_anomaly_rules
  for select to authenticated
  using (org_id in (select rfp_my_orgs()));

commit;

-- 켜져 있어야 한다. 꺼져 있으면 여기서 멈춘다
do $$
begin
  if not (select relrowsecurity from pg_class where relname = 'rfp_anomaly_rules') then
    raise exception 'rfp_anomaly_rules 의 RLS 가 꺼져 있다';
  end if;
end $$;
