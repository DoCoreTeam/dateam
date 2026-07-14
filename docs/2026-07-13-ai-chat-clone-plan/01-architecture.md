# AI 채팅 클론 — 아키텍처 (기획 전용)

> **세부 명명·시그니처·스키마는 `sessions/04-implementation-contract.md`(단일 구현 계약, SSOT)가 우선한다.** 본 문서는 구조 개요 — 어긋나는 표기가 있으면 04가 정답.

## 0. 시스템 데이터 저장 위치 (dateam 규약 — SSOT, 반드시 준수)
| 데이터 종류 | 저장 위치 | 방법 |
|-------------|-----------|------|
| 정형 데이터(대화·메시지·첨부메타·피드백·프로젝트) | **Supabase Postgres 테이블** | `supabase/migrations/NNN_*.sql` **순번 마이그레이션**을 `./scripts/migrate.sh`로 적용(Supabase CLI 아님). 현재 최신 149 → 신규 150+ |
| 행 수준 접근제어 | **RLS 필수**(모든 테이블) | admin-only + owner 스코프, default-deny (`org_weekly_reports` 패턴) |
| AI 프로바이더 키·모델·설정 | **`org_content` 테이블 `key='META'` JSONB** | 기존 `gemini_api_key`와 동일 위치에 `claude_api_key`/`claude_model`/`openai_api_key`/`openai_model`/`ai_chat_default_provider` 추가(표준명 — `anthropic_api_key` 표기 폐기, 04 §7). 키는 **서버 전용** |
| 업로드 파일(이미지·PDF·문서) | **Supabase Storage (admin 전용 버킷 `ai-chat`)** | 서버 서명 URL/base64로 프로바이더 전달. 메타는 `ai_attachments` 테이블 |
| 토큰/비용 사용량 | **`ai_token_logs` 테이블** | `lib/token-logger.ts` 경유(+ `provider` 컬럼 신설) |
| 벡터(프로젝트 지식 — 배치 3) | **pgvector**(기존 메모 임베딩과 동일 스택) | `gemini-embedding` 패턴 재사용 가능 |
| 경로/앱 설정 | Postgres/`org_content` | `.env`에 비밀 하드코딩 금지 |
→ **결론: AI 채팅의 모든 데이터는 dateam 기존 규약(Supabase Postgres + migrate.sh + RLS + org_content META + Supabase Storage)에 정확히 편입.** 별도 저장소 신설 없음.

## 0-1. 모델 등급 정책 (확정 — "고급 모델로 진행")
- 각 프로바이더의 **최상위(고급) 모델을 기본값**으로. admin이 오버라이드 가능:
  - **Claude**: 기본 `claude-opus-4-8`(최상위 Opus). 최고성능 옵션 `claude-fable-5`(Anthropic 최상위) 선택 가능. thinking=adaptive(summarized), 스트리밍 필수.
  - **Gemini**: 최상위 Pro 계열(admin이 `gemini_model`로 설정한 상위 모델).
  - **OpenAI**: 최상위 계열(admin 설정).
- 자동 제목/요약 등 경량 작업만 저비용 티어 허용(비용 최적화, 대화 응답은 항상 고급).


## 1. 전체 구조
```
[좌측 "AI채팅" 메뉴 / 사이드바 "새 대화" 버튼 — FAB 미도입 확정]  (admin만 노출)
        │
   /admin/ai-chat  (admin/layout 자동 게이팅)
   ┌───────────────┬────────────────────────────┐
   │ 대화목록 사이드바 │  채팅 패널(메시지 + 입력 + 모델선택)  │
   └───────────────┴────────────────────────────┘
        │ (전송)
   POST /api/admin/ai-chat/stream  (admin 인가 필수)
        │  ← 대화.provider 로 어댑터 선택
   lib/ai-chat/providers/{gemini,claude,openai}.ts   ← 공용 인터페이스
        │  ← admin META의 해당 provider api_key/model
   [Provider API 스트리밍]  →  SSE(data:{"delta"} / data:{"done":true,"messageId"} / 에러=data:{"done":true,"error"})
        │
   ai_conversations / ai_messages 저장 + token-logger(provider)
```

## 2. 프로바이더 추상화 (핵심 — 멀티 AI 대응)
현재 `gemini-*.ts`는 Gemini에 직결. 채팅은 **프로바이더 무관 인터페이스**를 신설하고, 기존 Gemini 라이브러리는 건드리지 않는다(회귀 0).

`lib/ai-chat/provider.ts` (인터페이스 — 확정형은 04 §4):
```ts
export type ProviderId = 'gemini' | 'claude' | 'openai'
export interface ChatTurn { role: 'user' | 'assistant'; content: string; attachments?: AttachmentInput[] /* S2 */ }
export interface ChatProvider {
  id: ProviderId
  label: string
  capabilities: { vision: boolean; tools: boolean; thinking: boolean; defaultMaxOutputTokens: number }  // 4필드 — S1부터 전부 선언
  // 스트리밍 채팅 — 콜백+Promise 스타일 확정(AsyncIterable 표기 폐기 — 04 §4). 입력 필드명은 `turns`.
  streamChat(params: {
    apiKey: string; model: string; system?: string
    turns: ChatTurn[]; maxOutputTokens?: number; signal: AbortSignal
    tools?: { webSearch?: boolean }                                     // S3
    onDelta: (text: string) => void
    onThinking?: (text: string) => void                                 // S1 — Claude summarized thinking
    onCitation?: (c: AiChatCitation) => void                            // S3
    onToolStatus?: (s: 'searching' | 'done') => void                    // S3
  }): Promise<{ text: string; thinking: string | null; usage: ChatUsage; stopped: boolean; citations?: AiChatCitation[] }>
  // 대화에 쓸 수 있는 모델 목록 — string[] 고정({id,label}[] 표기 폐기 — 04 §4)
  listModels(apiKey: string): Promise<string[]>
}
```
어댑터:
- `providers/gemini.ts` — 기존 `streamGenerateContent?alt=sse` 로직을 이 인터페이스로 래핑(재사용).
- `providers/claude.ts` — **`@anthropic-ai/sdk`** 사용. `client.messages.stream({ model, max_tokens, thinking:{type:'adaptive',display:'summarized'}, system, messages })` → `text`/`thinking` 델타 방출. 기본 모델 `claude-opus-4-8`(스킬 권고). 긴 출력·스트리밍 필수.
- `providers/openai.ts` — **`openai` SDK** 사용, 동일 인터페이스(배치 1 확정 — 3종 동시 추상화).

**프로바이더 레지스트리** `lib/ai-chat/registry.ts`:
- admin META를 읽어 **키가 설정된 provider만 available**로 반환:
  - `gemini` ← `gemini_api_key` / `gemini_model`
  - `claude` ← `claude_api_key`(신규) / `claude_model`(신규)
  - `openai` ← `openai_api_key`(신규) / `openai_model`(신규 — 모델 미설정 시 available 제외)
- 대화는 `provider`+`model`을 저장. 신규 대화 기본값 = admin이 지정한 default provider(META `ai_chat_default_provider`) 또는 첫 available — registry `getDefaultProvider(meta)`(04 §7).
- "여러 개면 여러 개 사용" = 대화별 provider/model 선택 드롭다운(available만 노출).

## 3. 스트리밍
- **서버**: `db-chat/route.ts`의 SSE 래핑 패턴 재사용(ReadableStream + `data:` 이벤트). 어댑터의 `streamChat` 델타를 `data:{"delta":"..."}` 로 흘리고, 종료 시 `data:{"done":true,"messageId":"<uuid>"}` + 최종 저장. 에러는 `data:{"done":true,"error":"..."}` 결합형(단독 `{"error"}` 이벤트 없음 — 04 §5).
- **클라이언트**: `DbChatTab`의 reader 루프를 **공용 훅 `lib/ai-chat/use-sse-chat.ts`로 추출**(현재 인라인 중복). 스트리밍 중 커서·Stop(AbortController) 지원.
- Claude 어댑터도 동일 SSE 봉투로 통일 → 클라이언트는 프로바이더 무관.

## 4. 데이터 모델 (신규 테이블 — admin 전용)
`migration NNN_ai_chat.sql` (스케치 — **확정 DDL·컬럼 전체는 세션1 §2-1과 04 §2**: `thinking`·`stopped` 컬럼 등 포함):
```sql
create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,  -- 소유 admin
  title text not null default '새 대화',
  provider text not null,          -- 'gemini'|'claude'|'openai'
  model text not null,
  system_prompt text,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz                         -- 소프트삭제
);
create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null default '',
  provider text, model text,
  prompt_tokens int, output_tokens int,
  error text,
  created_at timestamptz not null default now()
);
create index on ai_messages (conversation_id, created_at);

-- 멀티모달 첨부 (확정 포함)
create table ai_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references ai_messages(id) on delete cascade,  -- 전송 전 임시=null 허용
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  storage_path text not null,        -- Supabase Storage 경로 (admin 전용 버킷)
  filename text not null,
  mime text not null,
  size_bytes int not null,
  kind text not null check (kind in ('image','pdf','document','other')),
  created_at timestamptz not null default now()
);
create index on ai_attachments (conversation_id);
```

**RLS (default-deny, admin-only + 소유자 스코프)** — `org_weekly_reports` 패턴:
```sql
-- admin이면서 본인 소유 대화만 (admin 간 격리; 공유는 오픈이슈)
using ( exists(select 1 from profiles where id=(select auth.uid()) and role='admin' and deleted_at is null)
        and user_id = (select auth.uid()) )
```
- 서버는 `createAdminClient()`(service_role)로 write(RLS 우회), RLS는 이중 방어.
- 토큰 로깅: `ai_token_logs`에 `provider text` 컬럼 추가 + `AiFeature` enum에 `'ai-chat'` 추가(마이그레이션).

## 4-1. 멀티모달 · 파일업로드 (확정 포함)
- **스토리지**: Supabase Storage **admin 전용 버킷**(`ai-chat`), RLS/정책으로 owner(admin)만 read/write. 서버가 서명 URL 또는 base64로 프로바이더에 전달.
- **업로드 흐름**: 클라 → `POST /api/admin/ai-chat/upload`(admin 인가, mime/size 화이트리스트·상한) → Storage 저장 → `ai_attachments` 레코드 → 전송 시 message에 연결.
- **프로바이더 매핑**(capability 플래그로 분기):
  - Claude(`supportsVision/doc`): image/document content 블록(base64) 또는 Files API.
  - Gemini: `inline_data`(base64) 또는 Files API(`fileData`).
  - OpenAI: `image_url`(data URL) / file input.
  - 미지원 프로바이더: 첨부 UI 비활성 + 안내(요구사항 배치 2a).
- **입력 검증/보안**: mime 화이트리스트(image/*, application/pdf, 문서류), 용량 상한, 파일명 sanitize, 실행형/스크립트 차단. 복원 시 서명 URL 만료 관리.
- **인터페이스 확장(확정)**: `ChatTurn.attachments?: AttachmentInput[]` 옵션 필드 추가(04 §4 — content union 확장안 폐기). docx/xlsx/pptx는 서버측 텍스트 추출(officeparser) 후 document 경로로 전달(세션2 §3-2).

## 5. 어드민 AI 설정 확장
`admin/settings`에 **Claude·OpenAI 섹션 신설** + `actions.ts`에 `saveClaudeKey`/`saveClaudeModel`/`getClaudeModels` + `saveOpenAiKey`/`saveOpenAiModel`/`getOpenAiModels` + `saveAiChatDefaultProvider`(04 §6-3). META 신규 키(표준명): `claude_api_key`, `claude_model`, `openai_api_key`, `openai_model`, `ai_chat_default_provider`.
- Claude 모델 목록: 스킬 기준 고정 목록(`claude-opus-4-8` 등) 또는 `GET /v1/models`.
- **키는 서버에서만 사용. 클라이언트로 절대 전송 금지.**

## 6. UI (라우트/컴포넌트)
- 라우트: `app/admin/ai-chat/page.tsx` (서버 컴포넌트, 대화목록 로드) + `AiChatClient.tsx`(사이드바+채팅 패널). `admin/layout`이 자동 admin 게이팅.
- 렌더: 마크다운+코드블록 렌더러 신설(`react-markdown`+`remark-gfm`+`rehype-highlight`, raw HTML 비활성 `skipHtml` — **DOMPurify 미도입**(04 §8), sanitize 철학은 skipHtml로 충족). RichText는 코드 미지원이라 별도.
- 재사용: `AXDotLoader`(스트리밍 인디케이터), 디자인 토큰, `input-field`/모달 표준.

## 7. 통합 지점 (정확 위치)
- 좌측 메뉴: `admin/layout.tsx` `ADMIN_NAV_GROUPS`에 `{ href:'/admin/ai-chat', label:'AI 채팅', icon:<Bot/> }` 추가.
- FAB: **미도입 확정**(세션1 §7-3) — admin 화면은 `QuickAddFab`의 `/admin` null 가드 유지(개조 없음). "새 대화" 진입점 = 페이지 사이드바 버튼 · 빈 상태 중앙 버튼 · 모바일 채팅 헤더 +.
- "대화 목록 표시": **확정 — `/admin/ai-chat` 내부 사이드바(`ConversationSidebar.tsx`)로 처리**(세션1 §7-2 — 글로벌 네비(MobileShell) 개조는 (member) 전 화면 영향 리스크로 기각).

## 8. 보안 (OWASP 관점 — 기획 반영)
- GET/POST/stream **모두 admin 서버 인가**(라우트 + RLS 이중).
- API 키 서버 전용, 응답/클라이언트 노출 금지.
- 렌더 마크다운 sanitize(스크립트/이벤트 차단), 링크 `rel=noopener`.
- 토큰 남용 방지: 기존 `ai_token_alert_threshold` + provider별 집계로 비용 가드.
- 프롬프트 인젝션: system_prompt는 admin 소유값만, 사용자 입력을 operator 권한으로 승격 금지.
