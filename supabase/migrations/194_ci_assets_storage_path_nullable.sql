-- 194_ci_assets_storage_path_nullable.sql
-- 링크 자료는 저장 경로가 없다.
--
-- 189에서 storage_path가 not null로 잡혀 있어 링크 행 자체가 들어가지 못했다
-- (실측: "자료를 등록하지 못했습니다 / INTERNAL").
-- 193이 이미 위치 제약(링크=URL 필수, 파일=경로 또는 드라이브ID 필수)을 걸어두었으므로
-- 컬럼 단위 not null은 중복이자 링크 경로를 막는 장애물이다.

begin;

alter table ci_assets alter column storage_path drop not null;

comment on column ci_assets.storage_path is
  '구 Supabase Storage 경로. 드라이브 저장분과 링크 자료는 null (위치 보장은 ci_assets_location_check)';

commit;
