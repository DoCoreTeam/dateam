-- 246_rfp_core.sql
--
-- RFP 분석기 1층 — 케이스와 문서 (기획서 newplan/RFP/RFP분석시스템_기획서_설계서_v0.0.1.md 3.7)
--
-- ## 왜 rfp_ 접두인가
--
-- 설계서 3.7.1 은 Postgres 스키마 `rfp` 를 권고한다. 그런데 이 호스트는 PostgREST 로
-- `public` 만 노출하고, 노출 스키마는 대시보드 설정이라 마이그레이션이 못 바꾼다.
-- 그래서 **뜻은 지키고 방법을 바꾼다** — `public.rfp_*` 로 이름공간을 나누되,
-- **호스트 테이블로 나가는 외래키를 하나도 만들지 않는다.** 나중에 별도 프로젝트로
-- 옮길 때 이 테이블들만 떠내면 되도록 남겨 두는 것이 이 규칙의 목적이다.
--
-- ## 왜 org_id 를 지금 넣나
--
-- 사내에서는 조직이 하나뿐이라 지금은 값이 늘 같다. 그래도 처음부터 넣는다 —
-- 나중에 붙이면 이미 쌓인 행의 소속을 사람이 손으로 정해야 하고, 그 순간 RLS 는
-- 「전부 보이거나 전부 안 보이거나」 둘 중 하나가 된다(설계서 2.2.3-3).
--
-- ## 임베딩 차원을 768 로 쓰는 이유
--
-- 설계서는 vector(1024) 를 적었지만 이 저장소의 임베딩 SSOT 는
-- `lib/gemini-embedding.ts` 의 `EMBED_DIM = 768`(text-embedding-004)이고,
-- 기존 마이그레이션 16곳이 전부 vector(768) 이다. 차원을 새로 만들면 임베딩 경로가
-- 두 벌이 되고, 모델을 바꿀 때 한쪽만 재임베딩된다.

-- ── ① 조직과 구성원 ────────────────────────────────────────────
-- 사내 사용 중에는 org 가 하나다. 표를 지금 만드는 것은 F12(독립 SaaS)를 위해서가 아니라
-- **RLS 를 처음부터 켜기 위해서**다 — 켜 두지 않으면 나중에 켜는 날 전 화면이 빈다.

create table if not exists rfp_orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan        text not null default 'internal',
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- 기본 조직 — id 를 고정해 코드가 참조할 수 있게 한다(랜덤이면 환경마다 달라진다)
insert into rfp_orgs (id, name, plan)
values ('00000000-0000-4000-8000-000000000001', '데이터얼라이언스 AX사업본부', 'internal')
on conflict (id) do nothing;

create or replace function rfp_default_org() returns uuid
language sql immutable as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;

-- profile_id 에 외래키를 걸지 않는다(위 규칙). 대신 유니크로 중복 가입만 막는다.
create table if not exists rfp_org_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references rfp_orgs(id) on delete cascade,
  profile_id  uuid not null,
  role        text not null default 'member' check (role in ('admin','member','viewer')),
  created_at  timestamptz not null default now(),
  unique (org_id, profile_id)
);
create index if not exists idx_rfp_org_members_profile on rfp_org_members (profile_id);

-- 지금 있는 사람을 전부 넣는다. 호스트의 admin 은 여기서도 admin 이다.
insert into rfp_org_members (org_id, profile_id, role)
select rfp_default_org(), p.id, case when p.role = 'admin' then 'admin' else 'member' end
from profiles p
on conflict (org_id, profile_id) do nothing;

/*
 * 새로 들어오는 사람도 자동으로 넣는다.
 *
 * 외래키가 아니라 트리거를 쓰는 이유: 외래키는 삭제를 전파해 **남의 표를 지운다**.
 * 트리거는 넣기만 한다. 그리고 실패해도 절대 막지 않는다 —
 * 이 조직 가입이 실패했다고 사용자 계정 생성이 되돌아가면 그게 더 큰 사고다.
 */
create or replace function rfp_enroll_new_profile() returns trigger
language plpgsql security definer as $$
begin
  begin
    insert into rfp_org_members (org_id, profile_id, role)
    values (rfp_default_org(), new.id,
            case when new.role = 'admin' then 'admin' else 'member' end)
    on conflict (org_id, profile_id) do nothing;
  exception when others then
    null;  -- 가입 실패가 계정 생성을 막지 않는다
  end;
  return new;
end $$;

drop trigger if exists trg_rfp_enroll_new_profile on profiles;
create trigger trg_rfp_enroll_new_profile
  after insert on profiles
  for each row execute function rfp_enroll_new_profile();

-- RLS 가 매 행마다 부르는 함수라 stable 로 둔다(요청 안에서 값이 안 변한다)
create or replace function rfp_my_orgs() returns setof uuid
language sql stable security definer as $$
  select org_id from rfp_org_members where profile_id = auth.uid()
$$;

create or replace function rfp_is_admin(target_org uuid) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from rfp_org_members
    where profile_id = auth.uid() and org_id = target_org and role = 'admin'
  )
$$;

-- viewer 는 읽기만 한다(설계서 3.7.4)
create or replace function rfp_can_write(target_org uuid) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from rfp_org_members
    where profile_id = auth.uid() and org_id = target_org and role in ('admin','member')
  )
$$;

-- ── ② 공고 원천 ────────────────────────────────────────────────
-- 나라장터에서 받아 오는 메타데이터. 케이스보다 먼저 생길 수 있어 따로 둔다
-- (사전규격 단계에서 공고만 담아 두는 경우 — 설계서 5장 4).

create table if not exists rfp_sources (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references rfp_orgs(id) on delete cascade,
  source_system      text not null check (source_system in ('g2b','nuri','agency','manual')),
  notice_no          text,
  notice_round       int,
  title              text,
  announcing_agency  text,
  demand_agency      text,
  budget_amount      bigint,
  estimated_price    bigint,
  base_price         bigint,
  notice_date        date,
  bid_open_at        timestamptz,
  contract_method    text,
  award_method       text,
  is_it_project      boolean,
  is_urgent          boolean,
  raw                jsonb not null default '{}',
  fetched_at         timestamptz,
  created_at         timestamptz not null default now()
);
-- 같은 공고를 두 번 담지 않는다. 차수가 없는 수기 입력은 막지 않는다(부분 유니크)
create unique index if not exists uq_rfp_sources_notice
  on rfp_sources (org_id, source_system, notice_no, notice_round)
  where notice_no is not null;

-- ── ③ 케이스 ───────────────────────────────────────────────────
-- RFP 「한 건」. 파일 여러 개가 여기 매달린다(설계서 5장 2).

create table if not exists rfp_cases (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references rfp_orgs(id) on delete cascade,
  source_id          uuid references rfp_sources(id) on delete set null,
  title              text not null,
  -- 등급은 기본값을 두지 않는다 — 인입할 때 사람이 반드시 고른다(설계서 3.3.2)
  doc_class          text not null check (doc_class in ('public','restricted','nda')),
  stage              text not null default 'uploaded',
  failed_at          text,
  failed_reason      text,
  attempts           int not null default 0,
  sector             text,
  project_type       text,
  budget_amount      bigint,
  duration_months    int,
  proposal_deadline  timestamptz,
  -- 정정공고로 갈린 앞 차수. 지우지 않고 이어 둔다(F11)
  supersedes_case_id uuid references rfp_cases(id) on delete set null,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- 케이스 삭제는 30일 뒤 물리 삭제다(설계서 3.7.3)
  deleted_at         timestamptz
);
create index if not exists idx_rfp_cases_org_stage on rfp_cases (org_id, stage, created_at desc);
create index if not exists idx_rfp_cases_deadline on rfp_cases (org_id, proposal_deadline)
  where deleted_at is null;

-- ── ④ 파일과 중간 표현 ─────────────────────────────────────────

create table if not exists rfp_document_files (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references rfp_cases(id) on delete cascade,
  org_id         uuid not null references rfp_orgs(id) on delete cascade,
  role           text not null default 'etc'
                 check (role in ('main','scope','notice','special_terms','proposal_guide',
                                 'forms','qna','amendment','etc')),
  original_name  text not null,
  storage_path   text,
  mime           text,
  format         text,
  size_bytes     bigint,
  sha256         text not null,
  page_count     int,
  -- 배포용 HWP 는 열 수 없다. 우회하지 않고 안내한다(설계서 4장 1)
  is_drm         boolean not null default false,
  uploaded_by    uuid,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
-- 같은 파일을 같은 케이스에 두 번 올리지 않는다
create unique index if not exists uq_rfp_files_sha
  on rfp_document_files (case_id, sha256) where deleted_at is null;
create index if not exists idx_rfp_files_org_sha on rfp_document_files (org_id, sha256);

create table if not exists rfp_document_ir (
  id              uuid primary key default gen_random_uuid(),
  file_id         uuid not null references rfp_document_files(id) on delete cascade,
  org_id          uuid not null references rfp_orgs(id) on delete cascade,
  version         int not null default 1,
  parser          text not null,
  parser_version  text,
  -- 60 미만이면 화면이 「파싱 품질 낮음」을 띄운다(설계서 3.3.3)
  quality_score   int,
  warnings        jsonb not null default '[]',
  ir_storage_path text,
  created_at      timestamptz not null default now(),
  unique (file_id, version)
);

create table if not exists rfp_doc_sections (
  id           uuid primary key default gen_random_uuid(),
  ir_id        uuid not null references rfp_document_ir(id) on delete cascade,
  org_id       uuid not null references rfp_orgs(id) on delete cascade,
  section_key  text not null,
  level        int not null default 1,
  title        text,
  number       text,
  parent_id    uuid references rfp_doc_sections(id) on delete cascade,
  -- 표준 목차 14종 중 하나. 못 고르면 null 로 남긴다 — 억지로 넣지 않는다
  category     text,
  page_start   int,
  page_end     int,
  order_no     int not null default 0
);
create index if not exists idx_rfp_sections_ir on rfp_doc_sections (ir_id, order_no);
create index if not exists idx_rfp_sections_category on rfp_doc_sections (org_id, category);

create table if not exists rfp_doc_blocks (
  id              uuid primary key default gen_random_uuid(),
  ir_id           uuid not null references rfp_document_ir(id) on delete cascade,
  org_id          uuid not null references rfp_orgs(id) on delete cascade,
  block_key       text not null,
  section_id      uuid references rfp_doc_sections(id) on delete set null,
  type            text not null,
  text            text,
  html            text,
  page_no         int,
  -- 원점 좌상단, 0~1 비율. 렌더링 이미지와 하이라이트 좌표를 맞춘다(설계서 3.4.3)
  bbox            real[],
  -- HWP 는 section_idx/para_idx, PDF 는 char span. 페이지는 근사라 정식 참조가 아니다
  source_ref      jsonb not null default '{}',
  order_no        int not null default 0,
  text_hash       text,
  ocr_confidence  real
);
create index if not exists idx_rfp_blocks_ir on rfp_doc_blocks (ir_id, order_no);
create index if not exists idx_rfp_blocks_section on rfp_doc_blocks (section_id);
-- 근거 대조가 원문을 문자로 훑는다. 한국어 형태소 파서가 없어 trigram 을 쓴다(설계서 4장 9)
create index if not exists idx_rfp_blocks_text_trgm
  on rfp_doc_blocks using gin (text gin_trgm_ops);

-- ── ⑤ 청크와 요구사항 ──────────────────────────────────────────

create table if not exists rfp_block_chunks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references rfp_orgs(id) on delete cascade,
  case_id          uuid not null references rfp_cases(id) on delete cascade,
  file_id          uuid references rfp_document_files(id) on delete cascade,
  block_ids        uuid[] not null default '{}',
  text             text not null,
  tsv              tsvector,
  embedding        vector(768),
  -- 모델을 바꾸면 전체 재임베딩이 필요하다. 어느 모델로 만든 값인지 함께 둔다
  embedding_model  text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_rfp_chunks_case on rfp_block_chunks (org_id, case_id);
create index if not exists idx_rfp_chunks_embedding
  on rfp_block_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_rfp_chunks_text_trgm
  on rfp_block_chunks using gin (text gin_trgm_ops);

create table if not exists rfp_requirements (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references rfp_orgs(id) on delete cascade,
  case_id            uuid not null references rfp_cases(id) on delete cascade,
  -- 정보화 사업의 SFR-001 같은 요구사항 번호
  req_code           text,
  category           text,
  title              text not null,
  description        text,
  priority           text,
  evidence_block_ids uuid[] not null default '{}',
  embedding          vector(768),
  created_at         timestamptz not null default now()
);
create index if not exists idx_rfp_requirements_case on rfp_requirements (org_id, case_id);

-- ── ⑥ RLS ─────────────────────────────────────────────────────
-- 모든 표가 예외 없이 켠다. 읽기는 소속 조직, 쓰기는 member 이상, 지우기는 admin.

alter table rfp_orgs            enable row level security;
alter table rfp_org_members     enable row level security;
alter table rfp_sources         enable row level security;
alter table rfp_cases           enable row level security;
alter table rfp_document_files  enable row level security;
alter table rfp_document_ir     enable row level security;
alter table rfp_doc_sections    enable row level security;
alter table rfp_doc_blocks      enable row level security;
alter table rfp_block_chunks    enable row level security;
alter table rfp_requirements    enable row level security;

do $$
declare t text;
begin
  -- org_id 를 직접 가진 표는 같은 규칙을 쓴다. 하나씩 쓰면 한 표만 빠뜨린다.
  foreach t in array array[
    'rfp_sources','rfp_cases','rfp_document_files','rfp_document_ir',
    'rfp_doc_sections','rfp_doc_blocks','rfp_block_chunks','rfp_requirements'
  ] loop
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format(
      'create policy %I on %I for select using (org_id in (select rfp_my_orgs()))',
      t||'_read', t);

    execute format('drop policy if exists %I on %I', t||'_write', t);
    execute format(
      'create policy %I on %I for insert with check (rfp_can_write(org_id))',
      t||'_write', t);

    execute format('drop policy if exists %I on %I', t||'_update', t);
    execute format(
      'create policy %I on %I for update using (rfp_can_write(org_id)) with check (rfp_can_write(org_id))',
      t||'_update', t);

    execute format('drop policy if exists %I on %I', t||'_delete', t);
    execute format(
      'create policy %I on %I for delete using (rfp_is_admin(org_id))',
      t||'_delete', t);
  end loop;
end $$;

-- 조직과 구성원은 규칙이 다르다 — 자기 조직만 보이고, 편집은 admin 뿐이다
drop policy if exists rfp_orgs_read on rfp_orgs;
create policy rfp_orgs_read on rfp_orgs for select
  using (id in (select rfp_my_orgs()));

drop policy if exists rfp_orgs_admin on rfp_orgs;
create policy rfp_orgs_admin on rfp_orgs for update
  using (rfp_is_admin(id)) with check (rfp_is_admin(id));

drop policy if exists rfp_org_members_read on rfp_org_members;
create policy rfp_org_members_read on rfp_org_members for select
  using (org_id in (select rfp_my_orgs()));

drop policy if exists rfp_org_members_admin on rfp_org_members;
create policy rfp_org_members_admin on rfp_org_members for all
  using (rfp_is_admin(org_id)) with check (rfp_is_admin(org_id));
