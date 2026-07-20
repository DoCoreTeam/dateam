-- 171_ai_analysis_documents.sql
-- 목록 심층분석 v3 — 완성 문서를 1급 객체로 승격(FR-11).
-- 신규 테이블 ai_analysis_documents 1개만 생성. 기존 테이블 변경 없음(safe/additive).
-- 근거: docs/2026-07-20-v0.7.353-list-analysis-semantic-grouping/01-architecture.md §2
--
-- 목적:
--   ⑥⑦단계(그룹별 재가공+정합 패스) 결과물인 "완성 문서"는 지금까지 세션/항목 안에서만
--   파생되어 브라우저를 벗어나면 별도 조회·재사용이 불가능했다. 이를 세션과 별개로 저장·
--   버전관리(revision) 가능한 1급 레코드로 분리한다.
--
--   - user_id: 소유자(RLS owner-only 기준).
--   - session_id: 파생 출처 세션(on delete set null — 세션이 지워져도 완성 문서는 보존).
--   - revision: 같은 세션에서 재생성될 때마다 +1 (문서 히스토리).
--   - title / body_md: 완성 문서 본문(마크다운).
--   - doc_type: ① 문서 유형 판정 결과 승계(참고용, 세션과 별개로 스냅샷).
--   - deleted_at: 소프트삭제(newAX 표준 필수 컬럼 정책).
--
-- RLS 패턴은 157_ai_analysis_sessions.sql의 owner-only 정책을 그대로 따른다
-- (이 기능도 requireAdminApi 게이트 하위이므로 admin+owner 동시 조건 유지).
-- updated_at 자동 갱신은 157의 트리거 함수 패턴을 재사용(테이블 전용 함수 신설).
--
-- 마이그레이션 적용은 CEO가 별도 수행 — 이 파일은 작성만.

create table if not exists ai_analysis_documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  session_id  uuid references ai_analysis_sessions(id) on delete set null,
  revision    integer not null default 1,
  title       text not null default '',
  body_md     text not null default '',
  doc_type    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists idx_aiad_user_recent
  on ai_analysis_documents (user_id, updated_at desc)
  where deleted_at is null;

create index if not exists idx_aiad_session
  on ai_analysis_documents (session_id);

alter table ai_analysis_documents enable row level security;

-- owner-only default-deny (RLS ON + 정책 미매치는 자동 거부). 4개 동작 각각 명시 정의.
drop policy if exists aiad_select_own on ai_analysis_documents;
create policy aiad_select_own on ai_analysis_documents
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists aiad_insert_own on ai_analysis_documents;
create policy aiad_insert_own on ai_analysis_documents
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists aiad_update_own on ai_analysis_documents;
create policy aiad_update_own on ai_analysis_documents
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists aiad_delete_own on ai_analysis_documents;
create policy aiad_delete_own on ai_analysis_documents
for delete to authenticated
using (user_id = (select auth.uid()));

create or replace function fn_aiad_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_aiad_touch on ai_analysis_documents;
create trigger trg_aiad_touch before update on ai_analysis_documents
for each row execute function fn_aiad_touch();
