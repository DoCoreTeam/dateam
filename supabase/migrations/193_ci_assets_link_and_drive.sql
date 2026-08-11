-- 193_ci_assets_link_and_drive.sql
-- 자료: 링크 등록 + 구글드라이브 저장 + 검색
--
-- 왜: ① 영상 소스를 파일로만 받을 수 있었다(링크 경로 없음)
--     ② 원본을 전부 우리 서버(Supabase Storage)에 쌓는 구조라 용량이 곧 한계다.
--        우리는 **분석만** 하고 원본 보관은 이미 연동된 구글드라이브에 맡긴다.
--     ③ 목록이 늘어나는데 검색도 페이지네이션도 없었다.

begin;

alter table ci_assets
  -- 표시명. 링크 자료는 파일명이 없으므로 제목이 필요하다.
  add column if not exists title text,
  -- 'file' = 실제 파일, 'link' = 외부 링크(원본을 우리가 안 갖는다)
  add column if not exists source_kind text not null default 'file',
  add column if not exists source_url text,
  -- 어디에 있는가: supabase(구), drive(신규 기본), external(링크라 보관 안 함)
  add column if not exists storage_provider text not null default 'supabase',
  add column if not exists drive_file_id text,
  add column if not exists thumbnail_url text,
  -- 링크에서 확보한 메타(제공자·길이·채널 등). 못 얻으면 빈 객체.
  add column if not exists link_meta jsonb not null default '{}';

alter table ci_assets drop constraint if exists ci_assets_source_kind_check;
alter table ci_assets add constraint ci_assets_source_kind_check
  check (source_kind in ('file', 'link'));

alter table ci_assets drop constraint if exists ci_assets_storage_provider_check;
alter table ci_assets add constraint ci_assets_storage_provider_check
  check (storage_provider in ('supabase', 'drive', 'external'));

-- 링크는 원본 URL이, 파일은 저장 위치가 반드시 있어야 한다.
-- 어느 쪽도 없는 유령 행을 만들지 않는다.
alter table ci_assets drop constraint if exists ci_assets_location_check;
alter table ci_assets add constraint ci_assets_location_check check (
  (source_kind = 'link' and source_url is not null)
  or (source_kind = 'file' and (storage_path is not null or drive_file_id is not null))
);

-- 목록 조회: 워크스페이스 + 최신순 (커서 페이지네이션의 기준)
create index if not exists idx_ci_assets_ws_created
  on ci_assets (workspace_id, created_at desc) where deleted_at is null;

-- 검색: 제목·파일경로·URL을 한 번에 훑는다
create index if not exists idx_ci_assets_search
  on ci_assets using gin (
    to_tsvector('simple',
      coalesce(title, '') || ' ' || coalesce(storage_path, '') || ' ' || coalesce(source_url, ''))
  );

create index if not exists idx_ci_assets_drive
  on ci_assets (drive_file_id) where drive_file_id is not null;

comment on column ci_assets.storage_provider is
  '원본 보관 위치. drive=구글드라이브(기본), supabase=구 저장분, external=링크라 미보관';

commit;
