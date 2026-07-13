-- 151_ai_chat_attachments.sql
-- 세션2: AI 채팅 첨부 + 피드백/편집분기 컬럼 + Storage 버킷/정책
-- 배경: 세션1(150 ai_conversations·ai_messages)에 멀티모달 첨부와 완성도(피드백·편집분기)를 얹는다.
--   첨부 본체=Supabase Storage 'ai-chat' 버킷, 메타=ai_attachments. admin 전용·owner 폴더 스코프.
-- SSOT: docs/2026-07-13-ai-chat-clone-plan/sessions/{session-2-multimodal-completeness.md §2, 04-implementation-contract.md §1-3·§2}
-- 적용: PGPASSWORD='...' ./scripts/migrate.sh 151_ai_chat_attachments.sql
--   ※ 3번(Storage) 블록이 소유권 문제로 실패할 수 있음 — 아래 3번 블록 상단 주의 참조.

-- ─────────────────────────────────────────────
-- 1) ai_attachments — 첨부 메타 (파일 본체는 Storage 'ai-chat' 버킷)
-- ─────────────────────────────────────────────
create table ai_attachments (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid references ai_messages(id) on delete cascade,      -- 전송 전 임시 상태 = null
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  storage_path    text not null,                                          -- '{user_id}/{conversation_id}/{id}.{ext}'
  filename        text not null,                                          -- 원본 파일명 (표시 전용 — 경로에 사용 금지)
  mime            text not null,
  size_bytes      int  not null check (size_bytes > 0),
  kind            text not null check (kind in ('image','pdf','document','other')),
  created_at      timestamptz not null default now()
);

create index idx_ai_attachments_conv    on ai_attachments (conversation_id, created_at);
create index idx_ai_attachments_message on ai_attachments (message_id) where message_id is not null;
-- 고아(전송 전 이탈) 첨부 정리 스캔용
create index idx_ai_attachments_orphan  on ai_attachments (created_at) where message_id is null;

alter table ai_attachments enable row level security;

-- RLS: admin + owner, default-deny (org_weekly_reports 패턴 — 150의 aicc_admin_owner와 동일 서브쿼리)
create policy aia_owner_admin on ai_attachments for all to authenticated
using (
  exists(select 1 from profiles where id=(select auth.uid()) and role='admin' and deleted_at is null)
  and user_id = (select auth.uid())
)
with check (
  exists(select 1 from profiles where id=(select auth.uid()) and role='admin' and deleted_at is null)
  and user_id = (select auth.uid())
);

-- ─────────────────────────────────────────────
-- 2) ai_messages 확장 — 피드백 / 편집분기
-- ─────────────────────────────────────────────
alter table ai_messages
  add column if not exists feedback smallint check (feedback in (-1, 1)),      -- null=없음, 1=👍, -1=👎
  add column if not exists parent_message_id uuid references ai_messages(id);  -- 편집분기: 편집 대상(원본) 메시지 id

create index if not exists idx_ai_messages_parent
  on ai_messages (parent_message_id) where parent_message_id is not null;

-- 참고: 대화 삭제 시 ai_messages는 conversation_id cascade로 한 문장에서 전체 삭제되므로
-- parent FK(no action)는 문장 종료 시점 검사로 위반 없음. 개별 메시지 삭제 기능은 없음.

-- ─────────────────────────────────────────────
-- 3) Storage — admin 전용 버킷 'ai-chat' + 정책
-- ─────────────────────────────────────────────
-- ⚠️ 적용 주의: Supabase 프로젝트에 따라 storage.objects 소유자가 supabase_storage_admin이라
--   pooler의 postgres 롤로 아래 create policy가 'must be owner of table objects'로 실패할 수 있다.
--   실패 시 이 3번 블록만(버킷 insert 포함) Supabase Dashboard SQL Editor에서 재실행(관리 롤 실행).
--   on conflict do nothing이라 재실행 안전. 1·2번 블록(테이블/컬럼)은 migrate.sh로 정상 적용된다.

-- 버킷: 비공개, 20MB, mime 화이트리스트 (서버 업로드 시 2차 검증과 동일 목록)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ai-chat', 'ai-chat', false,
  20971520,  -- 20MB
  array[
    'image/png','image/jpeg','image/webp',
    'application/pdf',
    'text/plain','text/csv','text/markdown','application/json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   -- docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         -- xlsx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'  -- pptx
  ]
)
on conflict (id) do nothing;

-- 정책: admin이면서 경로 1단계 폴더 = 본인 uid 인 객체만 (defense-in-depth —
-- 실제 read/write는 전부 서버 service_role 경유이지만, 클라이언트 직접 접근을 default-deny로 못박음)
create policy ai_chat_objects_select on storage.objects for select to authenticated
using (
  bucket_id = 'ai-chat'
  and exists(select 1 from profiles where id=(select auth.uid()) and role='admin' and deleted_at is null)
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy ai_chat_objects_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'ai-chat'
  and exists(select 1 from profiles where id=(select auth.uid()) and role='admin' and deleted_at is null)
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy ai_chat_objects_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'ai-chat'
  and exists(select 1 from profiles where id=(select auth.uid()) and role='admin' and deleted_at is null)
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
