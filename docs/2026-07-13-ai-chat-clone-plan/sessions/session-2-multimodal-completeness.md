# 세션 2 — 멀티모달 · 파일업로드 + 완성도 (구현 배치 2) — 상세설계

> 루프 실행 단위. 이 문서만으로 신규 세션이 완결 구현 가능하도록 자기완결적으로 작성. **설계 문서 — 코드 구현은 세션 실행 시.**
> 상위 기획: `docs/2026-07-13-ai-chat-clone-plan/{00-requirements,01-architecture,03-feature-manifest}.md`
> **공용 구현 계약(SSOT)**: `sessions/04-implementation-contract.md` — 명명·시그니처가 어긋나면 04가 우선.
> 전제: dateam(Next.js 14.2.29 App Router + Supabase, v0.7.294 기준). 데이터=Supabase Postgres(`scripts/migrate.sh`), 설정=`org_content` META, 파일=Supabase Storage, RLS 필수, **어드민 전용**, 고급 모델 기본.

---

## 1. 개요 / 선행조건 / 범위 / 제외

### 1-1. 개요
세션 1(핵심 채팅)에 두 축을 얹는다.
- **(A) 파일업로드 · 멀티모달**: 이미지(png/jpg/webp)·PDF·문서(txt/csv/md/json + docx/xlsx/pptx — office는 서버측 텍스트 추출)를 Composer에서 첨부(버튼·드래그·붙여넣기) → Supabase Storage `ai-chat` 버킷 저장 + `ai_attachments` 메타 → 전송 시 프로바이더별 멀티모달 블록으로 변환 전달 → 복원 시 재표시. vision 미지원 프로바이더는 첨부 비활성.
- **(B) 완성도**: 재생성 · 사용자 메시지 편집분기 · 대화검색 · pin 섹션 구분(정렬·토글은 세션 1 산출) · 대화별 시스템프롬프트 · thinking 접이식 표시(영속 복원 포함) · 응답 피드백(👍/👎).

### 1-2. 선행조건 (세션 1 완료·머지 필수)
| 항목 | 세션 1 산출물 (존재 확인 후 착수) |
|------|------|
| DB | `ai_conversations`(system_prompt·pinned 컬럼 포함) / `ai_messages`(thinking·stopped·error 포함) 테이블 + RLS(`aicc_admin_owner`·`aicm_admin_owner`) + 트리거(`trg_aicc_touch`·`trg_aicm_touch_conv`). 마이그레이션 **150** 적용 완료 |
| lib | `apps/web/lib/ai-chat/provider.ts`(ProviderId·ChatTurn·ChatProvider + `capabilities:{vision,tools,thinking,defaultMaxOutputTokens}` 4필드), `providers/{gemini,claude,openai}.ts`, `registry.ts`, `use-sse-chat.ts`(`send(body, ev)`·`onThinking` 포함) |
| API | `POST /api/admin/ai-chat/stream` — SSE 봉투 `data:{"delta":"..."}` / `data:{"thinking":"..."}` / `data:{"done":true,"messageId":"…"}` / 에러 `data:{"done":true,"error":"…"}` |
| 서버액션 | `app/admin/ai-chat/actions.ts` — createConversation / listConversations / renameConversation / softDeleteConversation / restoreConversation / togglePin / updateConversationModel / getMessages / autoTitle |
| UI | `app/admin/ai-chat/page.tsx` + `AiChatClient.tsx`(채팅패널 허브) + `ConversationSidebar.tsx`(별도 파일) + `MessageList.tsx` + `Composer.tsx` + `MarkdownMessage.tsx`(react-markdown+remark-gfm+`skipHtml` — RichText는 code/pre 미허용이므로 이 렌더러 재사용) |
| 게이트 | `requireAdmin`(페이지) / `requireAdminApi`(API), Supabase 헬퍼 `createClient`/`createAdminClient`(`lib/supabase/server.ts`) |

이 세션의 마이그레이션 번호는 **151** (`151_ai_chat_attachments.sql`).

### 1-3. 범위 (이 세션에서 완결)
1. 마이그레이션 151: `ai_attachments` + `ai_messages` 컬럼 2개(`feedback`, `parent_message_id`) + Storage 버킷·정책.
2. 업로드/삭제 API (`/api/admin/ai-chat/upload`).
3. 어댑터 멀티모달 확장 (ChatTurn.attachments + 프로바이더별 매핑).
4. 스트림 API 확장 (attachmentIds · regenerate · edit 모드 · thinking SSE의 UI 소비(방출은 세션 1 산출) · system_prompt 주입 확인).
5. 완성도 7종: 재생성 / 편집분기 / 검색 / pin 섹션 구분 / 시스템프롬프트 편집 / thinking 표시(영속 복원 포함) / 피드백.
6. UI: Composer 첨부, MessageBubble 액션 확장, 사이드바 검색·pin 섹션.
7. 단위테스트 3계열(첨부 매핑 · 검색 sanitize · 분기 재구성) + typecheck.
8. 신규 의존성: `officeparser` 1개(`pnpm --filter web add officeparser`) — docx/xlsx/pptx 첨부 텍스트 추출(세션 3 지식 업로드의 office·PDF 추출도 재사용, 04 §8).

### 1-4. 배치 3(세션 3) 구현 항목 (전체 확정 스펙 — 의존성 순서에 따른 분할, 유예 아님)
- Artifacts(프리뷰 패널) · Projects(대화 그룹+지식) · 서버 툴(웹검색) · 공유(admin 경계 내 옵트인)/내보내기 — 세션 3 설계 확정.
- **분기 전환 UI**(Claude.ai의 `< 2/2 >` 브랜치 네비게이션): 이 세션은 편집분기의 **저장·활성 스레드 재구성까지** 구현(항상 최신 활성 스레드 표시). 과거 분기 열람·전환 UI는 **세션 3 §5-5에 설계 확정** — 데이터 모델은 이 세션 산출 `parent_message_id`로 완결.
- thinking은 **영속이 표준**(150 `ai_messages.thinking` — 세션 1이 저장): 이 세션은 스트리밍 표시 + 복원 재표시 UI를 구현한다(§5-6).

---

## 2. DB 마이그레이션 — `supabase/migrations/151_ai_chat_attachments.sql` (전체 SQL)

적용은 사용자: `PGPASSWORD='...' ./scripts/migrate.sh 151_ai_chat_attachments.sql`

```sql
-- 151_ai_chat_attachments.sql
-- 세션2: AI 채팅 첨부 + 피드백/편집분기 컬럼 + Storage 버킷/정책

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
```

**⚠️ Storage 섹션 적용 주의(핸드오프 문서화 필수):** Supabase 프로젝트에 따라 `storage.objects`의 소유자가 `supabase_storage_admin`이라 pooler의 `postgres` 롤로 `create policy`가 `must be owner of table objects`로 실패할 수 있다. 실패 시 **§3 이후(3번 블록)만 Supabase Dashboard SQL Editor에서 재실행**(관리 롤로 실행됨). 1·2번 블록(테이블/컬럼)은 migrate.sh로 정상 적용된다. migrate.sh는 원자 적용이므로, 사전 확인이 어려우면 처음부터 151에는 1·2번만 담고 3번은 문서 내 SQL을 Dashboard로 적용하는 분리 운용도 허용(어느 쪽이든 이 문서의 SQL이 SSOT).

**경로 규약(SSOT):** `storage_path = '{user_id}/{conversation_id}/{attachment_id}.{ext}'`
- 1단계 폴더 = 소유자 uid → Storage 정책의 owner 판정 근거.
- `ext`는 **mime → 확장자 고정 매핑**(§3-2)으로 서버가 결정. 원본 파일명은 경로에 절대 사용하지 않는다(경로 인젝션·유니코드 파일명 문제 원천 차단). 원본명은 `ai_attachments.filename`에만 저장(표시용).

---

## 3. 업로드/삭제 API — `apps/web/app/api/admin/ai-chat/upload/route.ts`

서버액션이 아닌 **route handler**로 구현한다(서버액션 bodySizeLimit 기본 1MB — 20MB PDF 불가). 전송 형식은 **multipart/form-data 확정**(base64 JSON 대비 33% 오버헤드 회피 + 기존 `admin/settings/branding/route.ts` 업로드 패턴과 동일 계열. 붙여넣기 이미지도 `ClipboardEvent.clipboardData.files`가 File 객체이므로 FormData로 동일 처리).

### 3-1. `POST /api/admin/ai-chat/upload`

```ts
// Request: multipart/form-data
//   file: File (1개 — 다중 첨부는 클라가 파일별 병렬 POST)
//   conversationId: string (uuid)
//
// Response 200:
//   { attachment: { id: string; filename: string; mime: string; sizeBytes: number;
//                   kind: 'image'|'pdf'|'document'; signedUrl: string } }
// 오류: 400(검증 실패 — 형식/용량/개수/매직바이트), 401/403(requireAdminApi), 404(대화 없음/소유 아님), 500(스토리지)
export async function POST(req: NextRequest): Promise<NextResponse>
```

처리 순서(전 단계 서버에서 수행):
1. `requireAdminApi()` → 실패 시 그대로 반환.
2. `formData()` 파싱 → `file`/`conversationId` 존재 검증.
3. **대화 소유 검증**: `createAdminClient()`로 `ai_conversations`에서 `id=conversationId and user_id=user.id and deleted_at is null` 조회 → 없으면 404.
4. **mime/용량 화이트리스트** (§3-2 `ATTACHMENT_RULES` — `lib/ai-chat/attachments.ts` SSOT):

   | kind | mime | 파일당 상한 | 근거 |
   |------|------|------|------|
   | image | image/png, image/jpeg, image/webp | **5MB** | Claude API 이미지당 한도 |
   | pdf | application/pdf | **20MB** | Gemini inline 요청 총량 20MB 기준 |
   | document(텍스트) | text/plain, text/csv, text/markdown, application/json | **1MB** | 프롬프트 인라인 텍스트 |
   | document(office) | docx/xlsx/pptx (openxmlformats 3종 mime) | **10MB** | 서버측 텍스트 추출(officeparser) 후 전달 — 추출 텍스트는 `MAX_DOCUMENT_TEXT_CHARS`(100,000자) 절단 |

   그 외 mime → 400 `'지원하지 않는 파일 형식입니다 (이미지 png/jpg/webp · PDF · 문서 txt/csv/md/json/docx/xlsx/pptx)'`.
5. **매직바이트 스니핑**(mime 위장 차단): 버퍼 선두 바이트 검사 — PNG `89 50 4E 47`, JPEG `FF D8 FF`, WEBP `52 49 46 46 … 57 45 42 50`(offset 8), PDF `%PDF-`, office 3종(docx/xlsx/pptx)은 ZIP 시그니처 `50 4B 03 04`. 텍스트 계열 document는 스니핑 대신 **UTF-8 디코드 가능 + NUL 바이트 없음** 검사. 불일치 → 400. office는 업로드 시 `extractDocumentText` 시추출 1회로 파싱 가능 여부까지 검증(실패 → 400 `'문서에서 텍스트를 추출하지 못했습니다'`).
6. **개수 상한**: 해당 대화의 `message_id is null`(대기 중) 첨부가 이미 **5개**면 400 `'메시지당 첨부는 최대 5개입니다'`.
7. `ai_attachments` insert(admin client, `message_id=null`) → `id` 획득 → `storage_path = `${user.id}/${conversationId}/${id}.${extFromMime(mime)}`` update 없이 insert 시점에 id를 `gen_random_uuid()` 선생성해 함께 넣는 방식 권장(서버에서 `crypto.randomUUID()`로 id 생성 → insert에 id·storage_path 동시 지정).
8. `adminClient.storage.from('ai-chat').upload(storage_path, buffer, { contentType: mime, upsert: false })` → 실패 시 insert 롤백(delete) 후 500.
9. `createSignedUrl(storage_path, 3600)`(1시간) → 응답.
10. **고아 정리(best-effort)**: 응답 전 비동기로 `message_id is null and created_at < now()-interval '24 hours'` 첨부를 Storage remove + row delete (실패 무시 — 다음 업로드가 재시도).

### 3-2. 첨부 규칙 SSOT — `apps/web/lib/ai-chat/attachments.ts` (신규)

```ts
export type AttachmentKind = 'image' | 'pdf' | 'document' | 'other'
// ↑ DB check·AiChatAttachment.kind와 동일 4종 union(04 §3) — 'other'는 예약값(업로드 API 미발급)

export const DOCUMENT_TEXT_MIMES = ['text/plain', 'text/csv', 'text/markdown', 'application/json'] as const
export const DOCUMENT_OFFICE_MIMES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         // xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
] as const

export const ATTACHMENT_RULES: Record<Exclude<AttachmentKind, 'other'>, { mimes: readonly string[]; maxBytes: number }> = {
  image:    { mimes: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 5 * 1024 * 1024 },
  pdf:      { mimes: ['application/pdf'],                       maxBytes: 20 * 1024 * 1024 },
  document: { mimes: [...DOCUMENT_TEXT_MIMES, ...DOCUMENT_OFFICE_MIMES], maxBytes: 10 * 1024 * 1024 },
}
export function maxBytesForMime(mime: string): number      // 텍스트 계열 document는 1MB, office는 10MB, 그 외 kind 상한
export const MAX_DOCUMENT_TEXT_CHARS = 100_000             // 디코드/추출 텍스트 공통 절단 상한(초과 시 절단 + 말미 '[이하 절단]')
export const MAX_ATTACHMENTS_PER_MESSAGE = 5
export const MAX_REQUEST_ATTACHMENT_BYTES = 20 * 1024 * 1024  // 스트림 요청당 base64 원본 총량
export const SIGNED_URL_TTL_SEC = 3600

export function kindOfMime(mime: string): Exclude<AttachmentKind, 'other'> | null
export function extFromMime(mime: string): string          // 'image/png'→'png', 'text/markdown'→'md', '…wordprocessingml.document'→'docx' … 고정 맵
export function sniffMagicBytes(buf: Uint8Array, mime: string): boolean   // office 3종은 ZIP 'PK\x03\x04'
export async function extractDocumentText(buf: Uint8Array, mime: string): Promise<string>
// ↑ 서버 전용 — 텍스트 계열은 UTF-8 디코드, office 3종(+세션3 지식 업로드의 PDF)은 officeparser 텍스트 추출.
//   MAX_DOCUMENT_TEXT_CHARS 절단. 추출 실패 시 throw(호출측이 400/폴백 처리)
export function sanitizeFilenameForDisplay(name: string): string
// ↑ 제어문자 제거·200자 절단·경로구분자(/ \) 제거 — DB 저장 전 적용(표시 전용이지만 방어)
```

클라 accept 문자열도 여기서 파생: `ATTACHMENT_RULES` 의 mimes 평탄화 → `Composer`가 import (화이트리스트 이중정의 금지).

### 3-3. `DELETE /api/admin/ai-chat/upload` (전송 전 첨부 취소)

```ts
// Request: JSON { attachmentId: string }
// Response 200: { ok: true } / 400·401·403·404
export async function DELETE(req: NextRequest): Promise<NextResponse>
```

1. `requireAdminApi()`.
2. `ai_attachments`에서 `id=attachmentId and user_id=user.id and message_id is null` 조회 — **`message_id`가 채워진(전송 완료) 첨부는 삭제 불가**(404) → 대화 히스토리 무결성 보존(과거 턴 재전송에 필요).
3. Storage `remove([storage_path])` → row delete → `{ ok: true }`.

대화 소프트삭제 시 첨부는 그대로 두고(복구 대비), 향후 하드삭제 도입 시 conversation cascade + Storage prefix 삭제를 함께 수행(세션 3 이후 — 여기선 규약만 명시).

---

## 4. 어댑터 멀티모달 확장 — `lib/ai-chat/provider.ts` + `providers/*`

### 4-1. 인터페이스 확장 (`provider.ts` 수정)

```ts
// 세션1 ChatTurn { role, content }에 attachments 옵션 추가 — 기존 호출부 무수정 호환
export interface AttachmentInput {
  kind: 'image' | 'pdf' | 'document'
  mime: string
  filename: string
  dataBase64: string   // 서버가 Storage에서 download → base64 인코딩해 채움 (document는 원문 텍스트의 base64)
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  attachments?: AttachmentInput[]   // user 턴에만 사용
}
// ChatProvider.streamChat(콜백+Promise) / capabilities 4필드({vision,tools,thinking,defaultMaxOutputTokens}) 시그니처는 세션1 그대로 유지(04 §4)
```

### 4-2. 프로바이더별 매핑 — 순수함수로 분리 (`lib/ai-chat/attachments.ts`에 배치, 단위테스트 대상)

각 어댑터는 자기 매핑 함수만 호출한다. 매핑은 프로바이더 SDK 타입에 의존하지 않는 plain object를 반환(테스트 용이). document의 `dataBase64`는 항상 **텍스트의 base64**(텍스트 계열=디코드 원문, office=`extractDocumentText` 추출 결과) — 매핑 함수는 원본 포맷을 구분하지 않는다.

```ts
// Claude (@anthropic-ai/sdk messages content 블록)
export function toClaudeContent(turn: ChatTurn): Array<
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'document'; source: { type: 'text'; media_type: 'text/plain'; data: string }; title?: string }
  | { type: 'text'; text: string }
>
// image → image/base64 블록, pdf → document/base64, document → document/source.type='text'(디코드 원문, title=filename), 마지막에 text

// Gemini (REST generateContent parts)
export function toGeminiParts(turn: ChatTurn): Array<
  | { inline_data: { mime_type: string; data: string } }
  | { text: string }
>
// image·pdf·document 전부 inline_data(base64) + 마지막 text part (Gemini는 text/* inline 지원)

// OpenAI (chat.completions content parts)
export function toOpenAiContent(turn: ChatTurn): Array<
  | { type: 'image_url'; image_url: { url: string } }                            // data URL: `data:${mime};base64,${data}`
  | { type: 'file'; file: { filename: string; file_data: string } }              // pdf — file_data도 data URL
  | { type: 'text'; text: string }
>
// image → image_url(data URL), pdf → file 블록, document → 원문 디코드 후 text 블록에
// "[첨부 문서: {filename}]\n{원문}" 프리픽스로 병합(chat.completions에 텍스트 파일 블록 없음)

// vision 미지원 폴백 (모든 프로바이더 공용) — 첨부를 파일명 플레이스홀더 텍스트로 대체
export function attachmentFallbackText(atts: AttachmentInput[]): string
// → "[첨부 {n}개는 현재 모델에서 지원되지 않아 제외됨: a.png, b.pdf]"
```

어댑터 수정 골격:
- `providers/claude.ts`: `messages` 조립 시 `turn.attachments?.length ? toClaudeContent(turn) : turn.content`.
- `providers/gemini.ts`: `contents[].parts = toGeminiParts(turn)`.
- `providers/openai.ts`: `messages[].content = toOpenAiContent(turn)` (첨부 없으면 string 그대로).

### 4-3. `capabilities.vision === false` 처리 (3중 방어)

| 계층 | 동작 |
|------|------|
| UI (Composer) | 첨부 버튼 disabled + 툴팁 `'이 프로바이더는 파일 첨부를 지원하지 않습니다'`. 드래그/붙여넣기 이벤트 무시 + 동일 문구 토스트 |
| 스트림 API | **신규 첨부**(`attachmentIds` 지정)인데 현재 대화 provider의 `capabilities.vision===false` → 400 `'현재 프로바이더는 첨부를 지원하지 않습니다'` |
| 히스토리 재전송 | 과거 턴에 첨부가 있는 대화를 vision 미지원 프로바이더로 바꿔 이어가는 경우 — 해당 턴 content 앞에 `attachmentFallbackText()` 결과를 붙이고 attachments 생략(대화는 계속 가능, 정보 손실은 명시) |

### 4-4. 스트림 API 확장 — `app/api/admin/ai-chat/stream/route.ts` (수정)

요청 스키마(세션1 `{conversationId, content}`의 상위 호환):

```ts
type StreamBody = {
  conversationId: string
  mode?: 'send' | 'regenerate' | 'edit'   // 생략 = 'send'
  content?: string                        // send·edit 필수 (trim 후 1자 이상 또는 attachmentIds 1개 이상)
  attachmentIds?: string[]                // send·edit — 본인 소유·해당 대화·message_id null 인 것만 유효
  editedMessageId?: string                // edit 필수 — 활성 스레드 내 본인 user 메시지 id
}
```

공통 처리:
1. `requireAdminApi()` → 대화 소유 검증(admin client).
2. **system 주입 확인/보강**: `conversation.system_prompt`가 있으면 `streamChat({ system })`으로 전달(세션1에서 누락됐다면 이 세션에서 반드시 연결).
3. **히스토리 = 활성 스레드**: 메시지 전체 로드(asc) → `buildActiveThread()`(§5-2 SSOT) → **최근 40턴 상한**(세션 1과 동일 계약, 04 §5-2) → `error is null`만 → ChatTurn[] 변환. user 턴의 첨부는 `ai_attachments` 일괄 조회 → Storage `download()` → base64로 `attachments` 채움(document는 `extractDocumentText` 결과 텍스트의 base64 — §3-2).
4. **요청 총량 가드**: 히스토리 전체 첨부 원본 합이 `MAX_REQUEST_ATTACHMENT_BYTES`(20MB) 초과 시 **오래된 턴 첨부부터** `attachmentFallbackText('[첨부 생략(용량): …]')` 텍스트로 대체하며 감축.
5. SSE 봉투는 세션 1 계약 그대로(04 §5-2): `data:{"delta":"..."}` / `data:{"thinking":"..."}` / `data:{"done":true,"messageId":"<uuid>"}` / 에러 `data:{"done":true,"error":"..."}` — **단독 `{"error"}` 이벤트는 없다**. thinking SSE 방출은 세션 1 산출이며, 이 세션은 그 **UI 소비**(§5-6)를 추가.
6. 완료 시 메시지 저장 + token-logger(provider) — 세션1과 동일.

모드별:
- **send**: user 메시지 insert → `ai_attachments.message_id`를 새 user 메시지 id로 update(`where id in attachmentIds and user_id=me and conversation_id=conv and message_id is null` — affected rows ≠ attachmentIds.length면 400 롤백) → 스트림 → assistant insert.
- **regenerate**: §5-1.
- **edit**: §5-2.

---

## 5. 완성도 기능 상세

### 5-1. 재생성 (Regenerate)

- **트리거**: 활성 스레드 마지막 assistant 메시지의 hover 액션 `↻` (마지막 assistant에만 노출).
- **요청**: `POST /api/admin/ai-chat/stream` `{ conversationId, mode: 'regenerate' }`.
- **서버**:
  1. 활성 스레드 재구성 → 마지막 메시지가 `assistant`가 아니면 400.
  2. 히스토리 = 활성 스레드에서 마지막 assistant 제외.
  3. **현재 대화의 provider/model**로 재스트림(대화 설정을 바꾼 뒤 재생성하면 새 프로바이더 사용 — 의도된 동작).
  4. 완료 시 기존 assistant row를 **update로 치환**: `content`, `provider`, `model`, `prompt_tokens`, `output_tokens`, `error=null`, `feedback=null`(새 응답이므로 피드백 리셋). `created_at`은 유지(스레드 순서 보존). 삭제+재삽입 금지(첨부·FK 안정성).
- **클라**: 해당 버블 내용을 비우고 스트리밍 재렌더(use-sse-chat 재사용, 낙관적 교체). 실패 시 이전 내용 복원 + 에러 토스트.

### 5-2. 사용자 메시지 편집분기

**데이터 모델**: 편집 = 새 user 메시지 insert + `parent_message_id = 편집 대상(화면에 보이던 활성 메시지) id`. 원본과 그 이후 꼬리는 삭제하지 않고 비활성으로 남는다(분기 보존 — 전환 UI만 세션 3).

**활성 스레드 재구성 SSOT — `apps/web/lib/ai-chat/thread.ts` (신규, 서버·클라 공용)**

```ts
export interface ThreadMsg { id: string; parent_message_id: string | null; created_at: string /* + role·content 등 */ }

// created_at asc 정렬 입력 → 시간순 리플레이:
//  - parent 없는 메시지: 현재 스레드에 append
//  - parent 있는 메시지(편집): parent가 현재 스레드에 있으면 그 위치부터 절단(truncate at parent index) 후 자신 append.
//    parent가 스레드에 없으면(이미 다른 분기로 대체된 꼬리의 편집) 건너뜀.
export function buildActiveThread<T extends ThreadMsg>(sorted: T[]): T[] {
  let thread: T[] = []
  for (const m of sorted) {
    if (m.parent_message_id) {
      const idx = thread.findIndex(t => t.id === m.parent_message_id)
      if (idx < 0) continue
      thread = thread.slice(0, idx)
      thread.push(m)
    } else {
      thread.push(m)
    }
  }
  return thread
}
```

예시 타임라인 `u1 a1 u2 a2 u3 a3` 에서 u2 편집(u2′, parent=u2) → 활성: `u1 a1 u2′ (a2′ …)`. u2′ 재편집 시 parent는 **u2′**(화면의 활성 메시지) — 알고리즘이 자연 처리.

- **요청**: `POST /api/admin/ai-chat/stream` `{ conversationId, mode:'edit', editedMessageId, content, attachmentIds? }`.
- **서버**:
  1. `editedMessageId`가 활성 스레드 내 본인 `user` 메시지인지 검증(아니면 400).
  2. user 메시지 insert `{ content, parent_message_id: editedMessageId }` + 첨부 연결(send와 동일 규칙).
  3. 히스토리 = insert 후 활성 스레드(= 절단점 이전 + 새 편집 메시지) → 스트림 → assistant insert(parent null).
- **getMessages 동작 확장**(시그니처·봉투는 세션 1 계약 유지 — 04 §6-2): 서버가 전체 로드 → `buildActiveThread` 적용 → **활성 스레드에 대해** 커서 페이지네이션 후 반환(분기 재구성은 전체 컨텍스트가 필요하므로 재구성을 서버에서 수행. admin 전용·대화당 수백 건 규모라 허용).

  ```ts
  // 세션 1의 객체 파라미터 + {ok, items, nextCursor} 봉투 유지 — items에 attachments 필드 누적
  export async function getMessages(input: { conversationId: string; before?: string; limit?: number /*기본 50*/ }): Promise<{
    ok: boolean
    items?: Array<AiChatMessage /* thinking·feedback·parent_message_id 포함 */ & {
      attachments: Array<{ id: string; filename: string; mime: string; kind: string;
                           sizeBytes: number; signedUrl: string }> }>
    nextCursor?: string | null
    error?: string
  }>
  ```
  첨부 signedUrl은 호출 시마다 신규 발급(TTL 1h) — 복원 시 재표시 요건 충족.
- **UI**: user 버블 hover `✎` → 버블이 인라인 편집 모드(textarea `input-field`, 기존 첨부는 읽기전용 칩으로 유지 표시 — v1에서 편집 시 첨부 변경은 **새 첨부 추가만** 허용, 기존 첨부는 승계하지 않음을 안내) → `저장 후 재전송` / `취소` 버튼. 저장 시 이후 버블들이 사라지고(활성 스레드 갱신) 새 응답 스트리밍.

### 5-3. 대화 검색 (제목 + 본문)

**sanitize SSOT — `apps/web/lib/ai-chat/search.ts` (신규)**

```ts
// trim → 2~100자 검증(미달 시 null) → ilike 메타문자 이스케이프(% _ \) → 반환
export function sanitizeSearchQuery(raw: string): string | null
```

**서버액션 — `app/admin/ai-chat/actions.ts`에 추가**

```ts
// 반환은 표준 봉투(04 §6 공통 컨벤션 — bare 배열 반환 금지)
export async function searchConversations(q: string): Promise<{
  ok: boolean
  items?: Array<{
    id: string; title: string; pinned: boolean; updated_at: string
    snippet: string | null          // 본문 매치 시 매치 주변 ±40자 plain 발췌, 제목 매치만이면 null
  }>
  error?: string
}>
```

구현 규약:
1. `requireAdmin` 게이트(액션 파일 표준) + `sanitizeSearchQuery` — null이면 `{ ok: true, items: [] }`.
2. **PostgREST `.or()` 미사용**(쉼표·괄호 포함 검색어가 or 문법을 깨는 인젝션 표면) — **쿼리 2회 분리 후 병합**:
   - Q1: `ai_conversations` — `user_id=me and deleted_at is null and title ilike '%q%'` (limit 20)
   - Q2: `ai_messages` — 본인 대화 조인 스코프에서 `content ilike '%q%'` → `conversation_id` distinct + 첫 매치 content (limit 20)
3. 병합·중복 제거 → 정렬 `pinned desc, updated_at desc` → 상위 20건.
4. 검색은 ilike로 시작(admin 전용·수천 건 규모 — 인덱스 불요). pg_trgm/FTS 전환은 성능 문제 실측 시 후속 마이그레이션(이 세션 범위 아님, 명시).

**UI**: 사이드바 상단 검색 input(`input-field`, 좌측 `<Search size={14}/>`) — 300ms 디바운스, 2자 미만이면 일반 목록 복귀, 결과 항목에 제목+snippet(매치 부분 `<mark>` 대신 굵게 — 토큰 색상 준수), 클릭 시 해당 대화 오픈(`?c=<id>`), ESC로 클리어(`useEscClose`는 모달 전용이므로 input onKeyDown 처리).

### 5-4. 대화 pin — 섹션 구분 표시

- `pinned` 컬럼 · `togglePin` 액션 · **`pinned desc, updated_at desc` 정렬** · hover 메뉴의 고정/해제 토글 UI는 전부 **세션 1 산출물**(04 §6-2 — 누락 아님).
- 이 세션의 신규는 **사이드바 목록의 "고정됨" / "최근" 2섹션 구분 표시**뿐: pinned 대화에 `<Pin size={12}/>` 표시 + 섹션 헤더. 낙관적 갱신.

### 5-5. 대화별 시스템프롬프트

- **서버액션 추가**:
  ```ts
  export async function updateSystemPrompt(conversationId: string, systemPrompt: string | null): Promise<{ ok: boolean; error?: string }>
  // requireAdmin + 소유 검증 → trim, 4000자 상한(초과 시 { ok: false, error }), 빈 문자열 → null 저장 (throw 금지 — 04 §6 봉투 통일)
  ```
- **주입**: 스트림 라우트가 매 요청 `conversation.system_prompt` → `streamChat({ system })` (§4-4 공통 2단계).
- **UI — `SystemPromptModal.tsx` (신규)**: 채팅 패널 헤더의 `<Settings2 size={16}/>` 버튼 → 모달. **모달 5체크리스트 준수**: (a) `useEscClose(onClose)` (b) 헤더 우측 `<X size={18}/>` (c) 제목 `className="tape-title"` (d) 카드 `boxShadow:'0 20px 60px rgba(0,0,0,0.2)'` (e) backdrop `rgba(15,23,42,0.5)`. textarea=`input-field`, label=`label`. 설정된 대화는 헤더 버튼에 점 표시(`var(--accent)`).
- 프롬프트 인젝션 관점: system 값은 **admin 본인 소유 대화의 본인 입력**만 — 타 사용자 입력이 system으로 승격되는 경로 없음(01-architecture §8 유지).

### 5-6. thinking 표시 (영속 — 150 `ai_messages.thinking` 컬럼 사용)

- **데이터 흐름**: Claude 어댑터(adaptive/summarized)가 방출하는 `{thinking}` 델타 → 스트림 라우트가 `data:{"thinking":"..."}` SSE로 중계(세션 1 산출) → `use-sse-chat`의 `onThinking`(세션 1 산출)이 `thinkingText` 상태로 누적(메시지 content와 분리). 스트림 완료 시 서버가 `ai_messages.thinking`에 저장(세션 1 산출 — 04 §2-2) → `getMessages` items의 `thinking` 필드로 복원.
- **렌더 — MessageBubble 내 접이식 블록**: assistant 버블 상단에 `▸ 추론 과정` 토글(버튼, min-height 44px 불요 — 인라인 보조 컨트롤이지만 클릭영역 32px 이상). 스트리밍 중 자동 펼침 + `AXDotLoader`, 완료 시 자동 접힘. 본문은 `MarkdownMessage` 재사용, `color: var(--text-muted)`, `border-left: var(--border-w) solid var(--border-color)`.
- **영속·복원(표준)**: 새로고침/복원 시 저장된 `message.thinking`을 **접힌 토글로 재표시**(스트리밍 중에는 라이브 `thinkingText` 버퍼 사용). thinking이 null이거나 capability.thinking===false 프로바이더는 블록 자체 미렌더.

### 5-7. 응답 피드백 (👍/👎)

- **서버액션 추가**:
  ```ts
  export async function setMessageFeedback(messageId: string, feedback: 1 | -1 | null): Promise<{ ok: boolean; error?: string }>
  // requireAdmin → admin client로 메시지→대화 소유 검증(user_id=me) → ai_messages.feedback update (04 §6 봉투 통일)
  // (RLS aicm_admin_owner가 이중 방어)
  ```
- **UI**: assistant 버블 hover 액션에 `<ThumbsUp size={14}/>`/`<ThumbsDown size={14}/>`. 선택 상태는 `var(--accent)` 채움, 같은 값 재클릭 = 해제(null). 낙관적 갱신, 실패 시 롤백. 재생성 시 서버가 feedback=null 리셋(§5-1)이므로 클라도 동기화.
- 집계/리포트는 범위 외(데이터만 축적).

---

## 6. UI 변경 상세 (props · 상태)

### 6-1. `Composer.tsx` (수정)

```ts
interface ComposerProps {                    // 세션1 props에 추가
  conversationId: string | null
  visionSupported: boolean                   // registry capability — false면 첨부 전면 비활성
  disabled: boolean                          // 스트리밍 중 등
  onSend: (content: string, attachmentIds: string[]) => void
}

interface PendingAttachment {
  id: string                                 // 업로드 완료 전 임시 = `tmp-${crypto.randomUUID()}`
  filename: string; mime: string; kind: 'image'|'pdf'|'document'; sizeBytes: number
  signedUrl: string | null                   // 이미지 썸네일용
  status: 'uploading' | 'ready' | 'error'
}
// 상태: pendingAttachments: PendingAttachment[], isDragOver: boolean
```

- **입력 경로 3종**: ① 클립 버튼(`<Paperclip size={16}/>`) → hidden `<input type="file" multiple accept={ACCEPT}>` (ACCEPT는 `ATTACHMENT_RULES`에서 파생 import) ② textarea 래퍼 `onDragOver/onDragLeave/onDrop`(isDragOver 시 래퍼에 `outline: var(--border-w-2) dashed var(--accent)` — 클래스로) ③ `onPaste` — `clipboardData.files` 있으면 파일 처리.
- 파일별 **클라 사전검증**(mime·용량 — `ATTACHMENT_RULES` 재사용) 후 병렬 POST `/upload`. 실패 항목은 status='error' 칩 + 재시도/제거.
- **첨부 칩 영역**(textarea 위): 이미지=48px 썸네일(img signedUrl, `border-radius: var(--radius)`), pdf/document=`<FileText size={14}/>`+파일명(말줄임 160px)+크기. 각 칩 우상단 `<X size={12}/>` → DELETE API 후 목록 제거. 업로드 중엔 `AXDotLoader` 오버레이.
- 전송 가능 조건: `content.trim() || readyAttachments.length > 0`, 단 uploading 존재 시 전송 버튼 disabled. 전송 성공 후 pendingAttachments 클리어.
- `visionSupported===false`: 버튼 disabled+툴팁, drop/paste 무시+토스트(§4-3). 대화 새로 만들 때가 아니라 **현재 선택된 provider 기준으로 실시간 반영**.
- 인라인 `<style>` 금지 — 신규 클래스는 `globals.css`에 `ai-chat-*` 프리픽스로 추가(디자인 토큰만 사용).

### 6-2. `MessageList.tsx` / `MessageBubble` (수정)

```ts
interface MessageBubbleProps {
  message: { id: string; role: 'user'|'assistant'; content: string; thinking: string | null; feedback: -1|1|null
             attachments: Array<{ id: string; filename: string; mime: string; kind: string; signedUrl: string }> }
  isLastAssistant: boolean                   // 재생성 버튼 노출 조건
  isStreaming: boolean
  thinkingText: string | null                // 스트리밍 중 라이브 버퍼 — 완료·복원 후에는 message.thinking(영속, §5-6) 사용
  onRegenerate: () => void
  onEditSubmit: (messageId: string, content: string, attachmentIds: string[]) => void
  onFeedback: (messageId: string, value: 1 | -1 | null) => void
}
// 내부 상태: isEditing(user), editDraft, thinkingOpen
```

- **user 버블**: 본문 위에 첨부 표시 — 이미지는 최대 240px 미리보기(img, 클릭 시 signedUrl 새 탭 `rel="noopener"`), 파일은 칩. hover 액션: 복사 · `✎ 편집`(→ 인라인 편집 모드 §5-2).
- **assistant 버블**: (위→아래) thinking 접이식 → MarkdownMessage 본문 → hover 액션 바: 복사 · `↻ 재생성`(isLastAssistant && !isStreaming) · 👍 · 👎.
- 편집 저장/재생성 시 리스트 갱신은 상위 `AiChatClient`가 활성 스레드 재계산(`buildActiveThread` — 서버와 동일 SSOT import)으로 처리.

### 6-3. 사이드바 (`ConversationSidebar.tsx` — 세션 1 별도 파일 유지, 수정)

```ts
// 추가 상태: searchQuery: string, searchResults: SearchResult[] | null (null=검색 모드 아님), isSearching: boolean
```

- 상단: 새 채팅 버튼(기존) 아래 검색 input(§5-3).
- 목록: 검색 모드가 아니면 `고정됨`/`최근` 2섹션(§5-4 — 이 세션 신규), 검색 모드면 결과 리스트(snippet 포함).
- 항목 hover 메뉴: 이름변경 · 삭제 · 고정 토글(전부 세션 1 산출 유지).
- 3종 상태(로딩=`AXDotLoader`, 빈 목록/빈 결과 안내, 에러) 유지.

### 6-4. `AiChatClient.tsx` (수정) — 상태 배선 요약

- `page.tsx`(서버)가 registry에서 provider별 `capabilities`를 로드해 client에 전달 → 현재 대화 provider의 `vision`을 Composer에, `thinking`을 MessageBubble에 배선.
- `use-sse-chat`은 세션 1 산출 그대로 — 메서드명 **`send(body, ev)`** 고정(`start` 표기 폐기, 04 §5-3), `onThinking`도 세션 1 산출. 이 세션은 body(`StreamBody`)의 `mode`/`attachmentIds`/`editedMessageId` 필드 사용만 추가.

---

## 7. 테스트 전략

신규 테스트 파일 3개 — **`apps/web/package.json` `test` 스크립트 파일 목록에 반드시 추가**(자동 포함 안 됨).

| 파일 | 대상 | 케이스 |
|------|------|--------|
| `lib/ai-chat/attachments.test.ts` | 매핑·규칙 순수부 | ① `toClaudeContent`: image→image블록 / pdf→document base64 / document→document text(title=filename) / text 블록 마지막 배치 ② `toGeminiParts`: 3종 모두 inline_data + text ③ `toOpenAiContent`: image→data URL / pdf→file 블록 / document→text 병합 프리픽스 ④ `kindOfMime` 화이트리스트 외 null + office 3종 mime→'document' ⑤ `sniffMagicBytes`: png/jpeg/webp/pdf 정상·위장(mime=png, 바이트=pdf) 거부 + office ZIP 시그니처 ⑥ `attachmentFallbackText` 파일명 나열 ⑦ `sanitizeFilenameForDisplay` 제어문자·경로구분자 제거·200자 절단 ⑧ `extFromMime`·`maxBytesForMime` office 매핑(officeparser 경유 추출 자체는 수동 검증 항목) |
| `lib/ai-chat/search.test.ts` | `sanitizeSearchQuery` | ① `%`·`_`·`\` 이스케이프 ② 1자 → null ③ 101자 → null(또는 100자 절단 — 구현 확정치 하나로 고정) ④ 앞뒤 공백 trim ⑤ 한글/유니코드 통과 ⑥ 빈 문자열 → null |
| `lib/ai-chat/thread.test.ts` | `buildActiveThread` | ① 편집 없음 → 원본 그대로 ② 중간 user 편집 → 절단+대체 (u1 a1 u2 a2 u3 a3 + u2′ → u1 a1 u2′) ③ 편집의 편집(parent=직전 편집) ④ 첫 메시지 편집 → 전체 대체 ⑤ 비활성 꼬리 메시지를 parent로 갖는 고아 편집 → skip ⑥ 편집 후 이어진 신규 턴 포함 순서 보존 |

- 실행: `cd apps/web && pnpm test` + 단일 `node --test --experimental-strip-types "lib/ai-chat/thread.test.ts"`.
- `pnpm exec tsc --noEmit` 0 에러, `pnpm design:check` 통과(신규 UI 하드코딩 색·치수 0).
- 수동 검증(문서화하여 커밋): 3 프로바이더 × {이미지, PDF, docx/xlsx/pptx} 첨부 응답 확인 / vision 미지원 조합 비활성 / 재생성·편집분기 후 새로고침 복원 / 검색·pin 섹션·시스템프롬프트·thinking(새로고침 복원 재표시 포함)·피드백 각 1회.

---

## 8. 완료기준 체크리스트 (배치 2 = 확정 완성 스펙의 해당 항목 100%)

- [ ] **업로드**: 버튼·드래그·붙여넣기 3경로 → Storage `ai-chat` 저장 + `ai_attachments` 기록 + 칩/썸네일 표시 + 전송 전 삭제(X)
- [ ] **office 문서**: docx/xlsx/pptx 업로드(ZIP 시그니처 검증) → 서버 텍스트 추출(`extractDocumentText`/officeparser, 100k자 절단) → document 경로로 전달
- [ ] **멀티모달**: 이미지/PDF/문서(텍스트·office)가 Claude(image·document 블록)/Gemini(inline_data)/OpenAI(image_url·file)로 전달되어 응답에 반영
- [ ] **복원**: 재방문 시 getMessages가 첨부(신규 서명URL)와 함께 재표시
- [ ] **미지원 프로바이더**: capability.vision=false → 첨부 UI 비활성+안내, 서버 400 이중방어, 히스토리 폴백 텍스트
- [ ] **재생성**: 마지막 assistant 치환(update) + 현재 provider/model 재스트림 + feedback 리셋
- [ ] **편집분기**: parent_message_id 저장 → buildActiveThread 재구성 → 재실행, 원본 분기 데이터 보존
- [ ] **검색**: sanitize(이스케이프·길이) + 제목/본문 2쿼리 병합 + `{ok, items}` 봉투 + 사이드바 검색 UI(디바운스·snippet)
- [ ] **pin**: 사이드바 "고정됨"/"최근" 2섹션 구분(정렬·토글은 세션 1 산출 확인만)
- [ ] **시스템프롬프트**: 모달(5체크리스트) 편집 → streamChat system 주입 확인
- [ ] **thinking**: 접이식 블록(스트리밍 중 펼침/완료 접힘) + **영속 복원 재표시**(150 `ai_messages.thinking` — 새로고침 후 접힌 토글), 미지원 프로바이더 미렌더
- [ ] **피드백**: 👍/👎 토글 → `ai_messages.feedback` 저장·해제
- [ ] **RLS**: `ai_attachments` admin+owner default-deny + Storage 정책(버킷 비공개, owner 폴더 스코프)
- [ ] **보안**: mime 화이트리스트 + kind별 용량 상한 + 매직바이트 스니핑 + 파일명 sanitize(경로 미사용) + 서명URL TTL 1h + 메시지당 5개·요청 20MB 상한 + 고아 첨부 24h 정리
- [ ] **품질 게이트**: `tsc --noEmit` 0 · 단위테스트 3파일 통과(package.json test 목록 등재) · `design:check` 통과
- [ ] **리뷰**: 🟥 DC-REV(코드 품질) + 🟥 DC-SEC(업로드 취약점 집중 — mime 위장·경로 인젝션·SSRF성 URL 처리·용량 DoS)
- [ ] **산출물**: 마이그레이션 151 파일 생성(적용=사용자) · 로컬 커밋 `v{버전}: … claude`(push=사용자)

---

## 9. 배포 핸드오프 (루프가 직접 하지 않음 — EXEC-003 허용 예외)

1. **마이그레이션 151 적용** → **사용자**: `PGPASSWORD='...' ./scripts/migrate.sh 151_ai_chat_attachments.sql`
   - Storage 정책 블록이 `must be owner of table objects`로 실패하면: §2의 3번 블록 SQL만 Supabase Dashboard SQL Editor에서 재실행(버킷 insert 포함, `on conflict do nothing`이라 재실행 안전).
2. **Storage 버킷 확인** → **사용자**: Dashboard → Storage → `ai-chat` 존재·Private·20MB·mime 목록 확인.
3. **push** → **사용자**: `git push origin main`.
4. 배포 후 스모크: admin 계정으로 이미지 1장 첨부 질문 → 응답·새로고침 복원·비admin 401/403 확인.
