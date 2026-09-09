-- 250_rfp_storage.sql — RFP 원문 보관함
--
-- 왜 필요한가: 249 까지의 표는 **파일에 대한 사실**만 담았다(이름·크기·해시).
-- 정작 바이트를 어디에도 안 뒀기 때문에 워커가 파싱할 원문이 없었다 —
-- 케이스를 만들고 파일을 올려도 파이프라인이 첫 단계에서 아무것도 못 읽는다.
--
-- 읽기·쓰기는 전부 서버(service_role)를 지난다. 아래 정책은 그 위의 2차 방어다 —
-- 클라이언트가 버킷에 직접 붙는 길을 default-deny 로 못박는다.
--
-- ⚠️ pooler 의 postgres 롤로는 `create policy ... on storage.objects` 가
--    'must be owner of table objects' 로 실패할 수 있다. 실패하면 이 파일을
--    Supabase Dashboard SQL Editor 에서 재실행한다(on conflict / if not exists 라 재실행 안전).

-- ── ① 버킷 ────────────────────────────────────────────────────
-- 비공개. 크기 상한은 앱의 MAX_FILE_BYTES(200MB)와 같은 값이다 —
-- 여기만 작으면 앱은 통과시킨 파일이 저장 단계에서 조용히 죽는다.
-- mime 화이트리스트를 두지 않는다: 한글(.hwp)·구형 오피스는 브라우저가
-- 빈 mime 이나 octet-stream 으로 올려서, 목록으로 막으면 정작 주력 문서가 막힌다.
-- 종류 판정은 앱이 매직바이트로 한다(lib/rfp/parse/quality).
insert into storage.buckets (id, name, public, file_size_limit)
values ('rfp-docs', 'rfp-docs', false, 209715200)
on conflict (id) do nothing;

-- ── ② 정책 ────────────────────────────────────────────────────
-- 경로 1단계 = org_id. 그 조직의 구성원만 읽는다(rfp_org_members 와 같은 판정).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'rfp_docs_select'
  ) then
    create policy rfp_docs_select on storage.objects for select to authenticated
    using (
      bucket_id = 'rfp-docs'
      and exists (
        select 1 from rfp_org_members m
        where m.user_id = (select auth.uid())
          and m.deleted_at is null
          and m.org_id::text = (storage.foldername(name))[1]
      )
    );
  end if;
end $$;

-- 쓰기·지우기는 서버만 한다. authenticated 에 열지 않는다 —
-- 클라이언트가 직접 올리면 크기·종류 검사와 해시 중복 판정을 통째로 건너뛴다.

-- ── ③ 원문 경로를 표에 남긴다 ─────────────────────────────────
-- 246 에 이미 rfp_document_files.storage_path 와 rfp_document_ir.ir_storage_path 가 있다.
-- 없던 것은 **다시 읽어야 할 대상을 찾는 색인**이다: 경로가 비어 있는 행이 곧
-- 「바이트가 없는 파일」이고, 그건 파싱이 영원히 실패할 행이다.
create index if not exists idx_rfp_files_missing_bytes
  on rfp_document_files (case_id)
  where storage_path is null and deleted_at is null;

-- ── ④ 사업명은 문서에서 나온다 ────────────────────────────────
-- 인입 화면이 사업명을 먼저 물어보던 것을 없앴다. 공고문 안에 있는 것을
-- 사람에게 타이핑시키는 것은 같은 일을 두 번 시키는 것이다.
-- 임시 이름으로 만들고 분석이 진짜 사업명을 찾으면 대신한다.
--
-- 이 칸이 없으면 «AI 가 사람이 고친 이름을 덮는» 사고가 난다 —
-- 한 번 사람이 정한 이름은 다시 안 건드린다는 사실을 어딘가 적어 둬야 한다.
alter table rfp_cases add column if not exists title_confirmed boolean not null default false;

-- 이미 있던 케이스는 사람이 직접 적은 이름이다. 덮지 않는다
update rfp_cases set title_confirmed = true where title_confirmed = false;
