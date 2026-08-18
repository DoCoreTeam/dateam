-- 208_ci_delete_contract.sql — 삭제 릴레이션 계약을 DB가 강제한다
--
-- 왜: 채널을 지웠는데 그 채널의 게시물 55건이 "채널 미확인"으로 남았다(2026-08-18 실측).
--   원인은 `ci_contents.channel_id`가 ON DELETE SET NULL이라 DB가 연결만 끊었기 때문이다.
--   남은 게시물은 ⓐ 비교군이 사라져 '평소 대비'가 영원히 안 나오고(실측 배수 0/55건)
--   ⓑ 목록에 그대로 노출돼 화면을 어지럽히고 ⓒ 촬영 예약 20건이 살아남아 비용을 계속 썼다.
--   **남겨서 얻는 것이 하나도 없었다.**
--
-- 사용자 결정(2026-08-18, 원문): "채널이 삭제되면 수집함의 컨텐츠 당연히 삭제 되야 하고
--   이런식의 구현에 CRUD와 릴레이션은 FK나 PK를 통해서 정확하게 관리 되어야 해"
--
-- 이 마이그레이션의 원칙 — 모든 참조는 셋 중 하나로 **명시적으로** 분류한다:
--   소유(owns)   자식은 부모 없이 존재 이유가 없다 → ON DELETE CASCADE
--   참조(refs)   자식은 독립적이고 부모를 가리킬 뿐  → ON DELETE SET NULL
--   작업(work)   대기열·예약. FK를 걸 수 없는 폴리모픽 → **DELETE 트리거**로 강제
--
-- 되돌리기: 아래 각 ALTER의 역방향(CASCADE→SET NULL)과 DROP TRIGGER로 원복 가능하다.

begin;

-- ─────────────────────────────────────────────────────────────
-- ① 소유 관계를 CASCADE로 바로잡는다
-- ─────────────────────────────────────────────────────────────

-- 채널 → 게시물. 이 저장소에서 게시물의 대부분은 채널 훑기로 들어온다.
-- 사용자가 등록한 것은 채널이고 게시물은 그 결과물이다 — 채널이 부모다.
alter table ci_contents drop constraint if exists ci_contents_channel_id_fkey;
alter table ci_contents
  add constraint ci_contents_channel_id_fkey
  foreign key (channel_id) references ci_channels(id) on delete cascade;

-- 채널 → 발행물. 그 채널에 올린 기록이므로 채널이 사라지면 기록도 대상을 잃는다.
alter table ci_publications drop constraint if exists ci_publications_channel_id_fkey;
alter table ci_publications
  add constraint ci_publications_channel_id_fkey
  foreign key (channel_id) references ci_channels(id) on delete cascade;

-- ─────────────────────────────────────────────────────────────
-- ② 참조 관계는 SET NULL 그대로 둔다 (바꾸지 않는다는 것도 결정이다)
-- ─────────────────────────────────────────────────────────────
--   ci_contents.topic_id          주제는 부모가 아니라 라벨이다 → 지우면 미분류
--   ci_contents.content_group_id  그룹이 풀려도 게시물은 남는다
--   ci_publications.brief_id      이미 나간 게시 실적은 기획을 지워도 남아야 한다
--   ci_assets.brief_id            자산은 다른 기획에 재사용할 수 있다
--   ci_notifications.rule_id      알림 이력은 규칙을 지워도 남아야 한다
--   ci_corrections.promoted_rule_id  학습 근거는 규칙보다 오래 산다
--   ci_topics.parent_id / merged_into_id, ci_workspaces.default_topic_id  자기참조·기본값
--
-- ⚠️ 보류 1건: ci_content_groups.representative_content_id
--   대표 게시물이 사라지면 NULL이 되는데, 옳은 동작은 **다른 형제로 승계**다.
--   CASCADE로 바꾸면 그룹 전체가 사라져 더 틀린다 → 승계 로직이 생길 때 함께 다룬다.

-- ─────────────────────────────────────────────────────────────
-- ③ FK를 걸 수 없는 참조는 트리거로 강제한다
-- ─────────────────────────────────────────────────────────────
-- ci_jobs.target_id 는 게시물·채널 **둘 다**를 가리키므로 단일 FK를 걸 수 없다.
-- 지금까지 이 자리를 코드(delete.ts)에만 맡겼고, 코드는 실제로 잊었다 —
-- 어제 손으로 20건을 치웠는데 오늘 다시 20건이 생겼다.
-- **코드는 잊을 수 있고 DB는 잊지 않는다.** 그래서 DB로 내린다.

create or replace function ci_purge_refs_of_content() returns trigger
language plpgsql as $$
begin
  delete from ci_jobs where target_type = 'content' and target_id = old.id;
  delete from ci_board_items where item_type = 'content' and item_id = old.id;
  delete from ci_corrections where target_type = 'content' and target_id = old.id;
  return old;
end;
$$;

create or replace function ci_purge_refs_of_channel() returns trigger
language plpgsql as $$
begin
  delete from ci_jobs where target_type = 'channel' and target_id = old.id;
  delete from ci_board_items where item_type = 'channel' and item_id = old.id;
  delete from ci_corrections where target_type = 'channel' and target_id = old.id;
  return old;
end;
$$;

create or replace function ci_purge_refs_of_brief() returns trigger
language plpgsql as $$
begin
  delete from ci_board_items where item_type = 'brief' and item_id = old.id;
  return old;
end;
$$;

create or replace function ci_purge_refs_of_idea() returns trigger
language plpgsql as $$
begin
  delete from ci_board_items where item_type = 'idea' and item_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_ci_purge_content_refs on ci_contents;
create trigger trg_ci_purge_content_refs
  before delete on ci_contents
  for each row execute function ci_purge_refs_of_content();

drop trigger if exists trg_ci_purge_channel_refs on ci_channels;
create trigger trg_ci_purge_channel_refs
  before delete on ci_channels
  for each row execute function ci_purge_refs_of_channel();

-- 기획은 아이디어 삭제 시 CASCADE로 사라진다. 그때도 이 트리거가 돌아
-- **손자의 보드 항목**까지 정리된다 — 예전엔 아이디어의 것만 치워 손자가 남았다.
drop trigger if exists trg_ci_purge_brief_refs on ci_briefs;
create trigger trg_ci_purge_brief_refs
  before delete on ci_briefs
  for each row execute function ci_purge_refs_of_brief();

drop trigger if exists trg_ci_purge_idea_refs on ci_ideas;
create trigger trg_ci_purge_idea_refs
  before delete on ci_ideas
  for each row execute function ci_purge_refs_of_idea();

-- ─────────────────────────────────────────────────────────────
-- ④ 남아 있는 고아를 마지막으로 훑는다 (적용 시점 기준 0이어야 한다)
-- ─────────────────────────────────────────────────────────────
delete from ci_contents where channel_id is null;
delete from ci_jobs j
 where (j.target_type = 'content' and not exists (select 1 from ci_contents c where c.id = j.target_id))
    or (j.target_type = 'channel' and not exists (select 1 from ci_channels c where c.id = j.target_id));
delete from ci_board_items b
 where (b.item_type = 'content' and not exists (select 1 from ci_contents c where c.id = b.item_id))
    or (b.item_type = 'channel' and not exists (select 1 from ci_channels c where c.id = b.item_id))
    or (b.item_type = 'brief'   and not exists (select 1 from ci_briefs   c where c.id = b.item_id))
    or (b.item_type = 'idea'    and not exists (select 1 from ci_ideas    c where c.id = b.item_id));
delete from ci_snapshot_schedules s
 where not exists (select 1 from ci_contents c where c.id = s.content_id);

commit;
