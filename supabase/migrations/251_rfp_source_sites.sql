-- 251_rfp_source_sites.sql — 어디를 뒤질지 (사용자 개입)
--
-- 왜 필요한가: 레이더가 나라장터만 본다. 그런데 입찰 공고는 **기관 자기 사이트에도 올라온다** —
-- 지자체·공사·출연연은 자체 게시판에 먼저 붙이고 나라장터에는 늦게 올리거나 안 올리기도 한다.
-- 그동안 「어디를 볼지」를 정할 자리가 아예 없어서 나라장터 하나로 고정돼 있었다.
--
-- 사이트마다 스크레이퍼를 만들지 않는다. 목록 쪽 글자를 읽어 AI 가 공고 줄을 뽑는다 —
-- 기관이 게시판을 바꿀 때마다 코드를 고치는 방식은 유지가 안 된다.

create table if not exists rfp_source_sites (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references rfp_orgs(id) on delete cascade,
  name          text not null,
  -- g2b: 나라장터 열린 API, web: 기관 자체 게시판 쪽
  kind          text not null default 'web' check (kind in ('g2b', 'web')),
  -- web 일 때만. 공고 **목록** 쪽 주소다(상세가 아니라)
  url           text,
  -- 목록에서 상세로 가는 링크가 상대 경로면 여기에 붙인다
  base_url      text,
  enabled       boolean not null default true,
  -- 마지막으로 훑은 때와 결과 — 「왜 새 공고가 없지」를 화면이 설명할 수 있게
  last_run_at   timestamptz,
  last_result   jsonb not null default '{}',
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- 같은 주소를 두 번 등록하지 않는다. 수기로 이름만 다르게 넣는 일이 잦다
create unique index if not exists uq_rfp_source_sites_url
  on rfp_source_sites (org_id, url) where url is not null and deleted_at is null;
create index if not exists idx_rfp_source_sites_org on rfp_source_sites (org_id) where deleted_at is null;

alter table rfp_source_sites enable row level security;

drop policy if exists rfp_source_sites_read on rfp_source_sites;
create policy rfp_source_sites_read on rfp_source_sites
  for select using (org_id in (select rfp_my_orgs()));

drop policy if exists rfp_source_sites_write on rfp_source_sites;
create policy rfp_source_sites_write on rfp_source_sites
  for insert with check (rfp_can_write(org_id));

drop policy if exists rfp_source_sites_update on rfp_source_sites;
create policy rfp_source_sites_update on rfp_source_sites
  for update using (rfp_can_write(org_id));

drop policy if exists rfp_source_sites_delete on rfp_source_sites;
create policy rfp_source_sites_delete on rfp_source_sites
  for delete using (rfp_is_admin(org_id));

-- 나라장터는 기본으로 한 줄 넣어 둔다 — 설정이 비어 있으면 «어디를 보는지» 자체가 안 보인다
insert into rfp_source_sites (org_id, name, kind, enabled, note)
select id, '나라장터', 'g2b', true, '공공데이터포털 서비스 키가 있어야 동작합니다'
from rfp_orgs
where not exists (
  select 1 from rfp_source_sites s where s.org_id = rfp_orgs.id and s.kind = 'g2b'
);

-- 공고 첨부를 원문으로 받았는지 — 나라장터가 준 파일 주소를 그대로 남긴다
alter table rfp_document_files add column if not exists source_url text;
comment on column rfp_document_files.source_url is
  '공고에서 자동으로 받은 파일의 원래 주소. 사람이 올린 파일은 null';
