# 세션 1 — AI 채팅(Claude 클론) 기반 + 핵심 채팅(구현 배치 1) 상세설계

> 기준 코드베이스 버전: v0.7.294 · 작성일 2026-07-13
> 루프 실행 단위 문서. 이 문서만으로 신규 세션이 완결 구현 가능하도록 자기완결적으로 작성.
> 상위 기획: `docs/2026-07-13-ai-chat-clone-plan/{00-requirements,01-architecture,02-roadmap-and-decisions,03-feature-manifest}.md`
> **공용 구현 계약(SSOT)**: `sessions/04-implementation-contract.md` — 명명·시그니처가 어긋나면 04가 우선.
> 본 문서의 모든 파일 경로·식별자·시그니처는 **실제 코드에서 검증 완료** (placeholder 없음).

---

## 1. 개요 / 범위 / 선행조건 / 제외

### 1-1. 목표
어드민이 `/admin/ai-chat`에서 새 대화 생성 → 질문 → **스트리밍 응답(마크다운+코드블록 렌더)**을 받고, 대화·메시지가 Supabase에 영속되어 재방문/URL 공유 시 그대로 복원된다. **Gemini + Claude + OpenAI 3 프로바이더**를 공통 인터페이스로 추상화하고 대화 단위로 프로바이더/모델을 선택한다.

### 1-2. 세션 1 범위 (Feature Defaults 전개)
| 영역 | 포함 |
|---|---|
| 대화 관리 | Create / Read / Update(제목변경·핀·모델변경) / Delete(소프트삭제) + 삭제복원 + 목록(핀 우선 → `updated_at desc` 정렬, 커서 페이지네이션) + 자동 제목 + URL 동기화(`?c=<id>`) |
| 채팅 | 멀티턴 컨텍스트, SSE 스트리밍, Stop(중단 + 부분내용 저장), 메시지 복사, 마크다운+코드블록(코드 복사 버튼) |
| 프로바이더 | Gemini / Claude / OpenAI 추상화, META 기반 키·모델 관리, 대화별 전환 |
| 통합 | 좌측 어드민 메뉴 항목, 최근 대화 목록(페이지 내 사이드바), "새 대화" 진입점(FAB 미도입 — 결정 §7-3), 어드민 설정에 Claude/OpenAI 섹션 + 기본 프로바이더 셀렉트 |
| 품질 | RLS, 토큰 로깅(provider 구분), 단위테스트, typecheck, 로딩/빈/에러 3종 UI, 반응형, 다크/라이트 |

### 1-3. 선행조건
- 최신 마이그레이션 = `supabase/migrations/149_org_weekly_reports.sql` (확인됨) → **이 세션은 150 사용**.
- `org_content` META에 `gemini_api_key`/`gemini_model` 저장 체계 가동 중 (`apps/web/app/admin/settings/actions.ts` 확인됨).
- Claude/OpenAI API 키는 사용자(어드민)가 세션 완료 후 `/admin/settings`에서 직접 등록.

### 1-4. 배치 분할 (전체 확정 스펙 — 의존성 순서에 따른 후속 배치 항목)
- **세션 2(배치 2)**: 파일 업로드/멀티모달(docx/xlsx/pptx 서버 텍스트 추출 포함), 응답 재생성, 메시지 편집·분기, **대화 목록 검색**(리스트 어포던스 중 검색만 배치 2). — 본 세션이 만드는 테이블·프로바이더 추상화에 의존.
- **세션 3(배치 3)**: Artifacts, Projects, 툴(web_search), 공유(admin 경계 내 옵트인)/내보내기, 편집분기 브랜치 네비게이션, LaTeX, 비용 대시보드. — 세션 1·2 산출에 의존.
- 분할 근거는 **오직 의존성**(테이블·추상화 → 첨부·UI 완성도 → 고급). 전 항목이 확정 완성 스펙이며 유예·후보 항목은 없다.

---

## 2. DB 마이그레이션 150 + 타입 수정

### 2-1. `supabase/migrations/150_ai_chat.sql` (전체 SQL)

전제(검증됨):
- `ai_token_logs`(011 생성)의 `feature` 컬럼은 **text** — TS union만 확장하면 되고 DB enum 변경은 **불필요**.
- RLS 패턴은 149 `org_weekly_reports`의 admin 게이트 + owner 스코프를 결합.
- 서버는 `createAdminClient()`(service role, RLS 우회)로 쓰기하므로 RLS는 방어적 이중화.

```sql
-- 150_ai_chat.sql
-- AI 채팅(Claude 클론) 세션1: 대화/메시지 영속 + 토큰로그 provider 구분
-- feature 컬럼은 text이므로 'ai-chat' 값은 마이그레이션 불필요 (types/database.ts union만 확장)

-- 1) ai_token_logs에 프로바이더 구분 컬럼 추가 (기존 행은 null = gemini 시절 로그)
alter table ai_token_logs add column if not exists provider text;

-- 2) 대화 테이블
create table if not exists ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  title       text not null default '새 대화',
  provider    text not null check (provider in ('gemini','claude','openai')),
  model       text not null,
  system_prompt text,               -- 대화별 시스템프롬프트 (세션2 편집 UI에서 사용, 세션1은 항상 null)
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz          -- 소프트삭제 (복원 가능)
);
create index if not exists idx_aicc_user_recent
  on ai_conversations (user_id, pinned desc, updated_at desc)
  where deleted_at is null;

-- 3) 메시지 테이블
create table if not exists ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references ai_conversations(id) on delete cascade,
  role             text not null check (role in ('user','assistant')),
  content          text not null default '',
  thinking         text,                          -- Claude summarized thinking (있을 때만)
  provider         text,                          -- assistant 메시지의 생성 프로바이더
  model            text,                          -- assistant 메시지의 생성 모델
  prompt_tokens    integer,
  output_tokens    integer,
  stopped          boolean not null default false, -- 사용자 Stop으로 중단된 부분 응답
  error            text,                           -- 생성 실패 시 에러 메시지
  created_at       timestamptz not null default now()
);
create index if not exists idx_aicm_conv_time
  on ai_messages (conversation_id, created_at, id);

-- 4) RLS: admin 전용 + owner 스코프 (default-deny, 149 org_weekly_reports 패턴)
alter table ai_conversations enable row level security;
alter table ai_messages enable row level security;

drop policy if exists aicc_admin_owner on ai_conversations;
create policy aicc_admin_owner on ai_conversations
for all to authenticated
using (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and user_id = (select auth.uid())
)
with check (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and user_id = (select auth.uid())
);

drop policy if exists aicm_admin_owner on ai_messages;
create policy aicm_admin_owner on ai_messages
for all to authenticated
using (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and exists (select 1 from ai_conversations c
              where c.id = conversation_id and c.user_id = (select auth.uid()))
)
with check (
  exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and deleted_at is null)
  and exists (select 1 from ai_conversations c
              where c.id = conversation_id and c.user_id = (select auth.uid()))
);

-- 5) updated_at 자동 갱신 트리거 (149 fn_owr_touch 패턴)
create or replace function fn_aicc_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_aicc_touch on ai_conversations;
create trigger trg_aicc_touch before update on ai_conversations
for each row execute function fn_aicc_touch();

-- 6) 메시지 insert 시 부모 대화 updated_at 갱신 (최근 대화 정렬 소스)
create or replace function fn_aicm_touch_conv() returns trigger language plpgsql as $$
begin
  update ai_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end; $$;
drop trigger if exists trg_aicm_touch_conv on ai_messages;
create trigger trg_aicm_touch_conv after insert on ai_messages
for each row execute function fn_aicm_touch_conv();
```

적용: `PGPASSWORD='...' ./scripts/migrate.sh 150_ai_chat.sql` — **사용자 실행** (§10).

### 2-2. `apps/web/types/database.ts` 수정 (정확 위치)

**(a) AiFeature union 확장** — 384–403행(검증됨). 마지막 멤버 `| 'meeting_extract'`(403행) 바로 다음 줄에 추가:

```ts
export type AiFeature =
  | 'weekly-report-refine'
  // ... (기존 18개 유지) ...
  | 'meeting_extract'
  | 'ai-chat'          // ← 404행에 이 한 줄 추가. DB 마이그레이션 불필요(feature는 text 컬럼)
```

**(b) AiTokenLog 인터페이스** — 405행 `export interface AiTokenLog` 내 `feature: AiFeature` 다음 필드들 사이, `model` 필드 뒤에 추가:

```ts
  provider: string | null   // 150에서 추가된 컬럼
```

**(c) 신규 행 타입 추가** — AiTokenLog 인터페이스 뒤에 이어서:

```ts
export type AiChatProviderId = 'gemini' | 'claude' | 'openai'

export interface AiChatConversation {
  id: string
  user_id: string
  title: string
  provider: AiChatProviderId
  model: string
  system_prompt: string | null
  pinned: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface AiChatMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  thinking: string | null
  provider: string | null
  model: string | null
  prompt_tokens: number | null
  output_tokens: number | null
  stopped: boolean
  error: string | null
  created_at: string
}
```

### 2-3. `apps/web/lib/token-logger.ts` 수정 (검증된 현재 코드 기준)

`LogParams`(4–11행)에 `provider?: string` 추가, `logAsync`의 insert(17–25행)에 `provider: params.provider ?? null` 추가. 기존 호출처는 수정 불필요(옵셔널).

```ts
interface LogParams {
  userId: string | null
  feature: AiFeature
  model: string
  provider?: string          // ← 추가
  promptTokens: number
  outputTokens: number
  totalTokens: number
}
// insert 객체에: provider: params.provider ?? null,
```

---

## 3. 의존성 설치 (`apps/web`에 설치 — `pnpm --filter web add ...`)

| 패키지 | 용도 | 비고 |
|---|---|---|
| `react-markdown` | 마크다운 렌더 | 기존 `RichText.tsx`는 ALLOWED_TAGS에 `code`/`pre`가 없어 채팅용으로 부적합(검증됨) → 신규 렌더러 필수 |
| `remark-gfm` | GFM(테이블·취소선·자동링크) | react-markdown 플러그인 |
| `rehype-highlight` | 코드블록 문법 하이라이트 | |
| `highlight.js` | rehype-highlight 런타임 | 테마 CSS는 import하지 않고 `globals.css`에 `.hljs-*` 토큰 매핑 작성(§6-7) — 다크/라이트 자동 대응 |
| `@anthropic-ai/sdk` | Claude 프로바이더 (`messages.stream`) | 미설치 확인됨 |
| `openai` | OpenAI 프로바이더 | 미설치 확인됨 |

Gemini는 기존 컨벤션대로 **SDK 없이 REST 직호출**(`lib/gpu/extract-helpers.ts:186`, `api/pricing/gpu/db-chat/route.ts:132`와 동일 패턴) — 추가 의존성 없음.

---

## 4. `lib/ai-chat/` 모듈 상세

```
apps/web/lib/ai-chat/
├── provider.ts        # 공통 타입 (서버/클라 공용, 순수 타입)
├── registry.ts        # META 기반 프로바이더 가용성/설정 (순수 함수 — 단위테스트 대상)
├── sse.ts             # SSE 라인 파서 (순수 함수 — 단위테스트 대상, 서버/클라 공용)
├── providers/
│   ├── gemini.ts      # REST streamGenerateContent
│   ├── claude.ts      # @anthropic-ai/sdk messages.stream
│   └── openai.ts      # openai chat.completions stream
└── use-sse-chat.ts    # 'use client' 훅 (reader 루프 + AbortController)
```

### 4-1. `provider.ts` — 타입 전문

```ts
import type { AiChatProviderId } from '@/types/database'

export type ProviderId = AiChatProviderId   // 'gemini' | 'claude' | 'openai'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatUsage {
  promptTokens: number
  outputTokens: number
  totalTokens: number
}

export interface StreamChatParams {
  apiKey: string
  model: string
  system?: string
  turns: ChatTurn[]                 // 마지막 원소 = 이번 사용자 발화
  maxOutputTokens?: number          // 기본 §4-4~4-6 프로바이더별 값
  signal: AbortSignal               // Stop/클라 이탈 전파
  onDelta: (text: string) => void
  onThinking?: (text: string) => void  // Claude summarized thinking 전용
}

export interface StreamChatResult {
  text: string                      // 누적 전체 응답
  thinking: string | null
  usage: ChatUsage                  // 미보고 시 0
  stopped: boolean                  // signal abort로 중단됨
}

// capabilities는 세션 1부터 4필드 전부 선언(04 §4 확정) — vision·tools는 이 세션에선 선언만, 소비는 세션 2(vision)·세션 3(tools)
export interface ProviderCapabilities {
  vision: boolean
  tools: boolean
  thinking: boolean
  defaultMaxOutputTokens: number
}

export interface ChatProvider {
  id: ProviderId
  label: string                     // UI 표시명: 'Gemini' | 'Claude' | 'OpenAI'
  capabilities: ProviderCapabilities
  streamChat(params: StreamChatParams): Promise<StreamChatResult>
  listModels(apiKey: string): Promise<string[]>
}
```

**capability 확정값 (v1 — 04 §4)**: gemini `{vision:true, tools:true, thinking:false, defaultMaxOutputTokens:8192}` · claude `{vision:true, tools:true, thinking:true, defaultMaxOutputTokens:32000}` · openai `{vision:true, tools:false, thinking:false, defaultMaxOutputTokens:16384}`.

### 4-2. `sse.ts` — 순수 SSE 파서 (서버 프로바이더 + 클라 훅 공용, SSOT)

```ts
/** 버퍼에 청크를 누적하고 완결된 `data: ` 라인의 JSON만 파싱해 반환. 잔여 버퍼는 상태로 유지. */
export function createSseParser(): {
  push(chunk: string): unknown[]    // 파싱 성공한 JSON 이벤트 배열 (malformed는 skip)
  flush(): unknown[]
}
```
구현 규칙: `\n` 분리 → 마지막 미완 라인은 버퍼 보존 → `data: ` 접두 라인만 `JSON.parse`, 실패 시 무시. (`db-chat/route.ts:161-216`의 인라인 파싱 로직을 순수 함수로 승격 — 재사용·단일구현 정책.)

### 4-3. `registry.ts` — META 기반 가용성 (순수 함수)

```ts
import type { ProviderId } from './provider'

export const META_KEYS = {
  gemini: { apiKey: 'gemini_api_key', model: 'gemini_model' },
  claude: { apiKey: 'claude_api_key', model: 'claude_model' },
  openai: { apiKey: 'openai_api_key', model: 'openai_model' },
} as const

export const DEFAULT_MODELS: Record<ProviderId, string | null> = {
  gemini: 'gemini-2.0-flash',      // 기존 saveGeminiModel 미설정 시 폴백(기존 컨벤션)
  claude: 'claude-opus-4-8',       // 고급 모델 기본 (확정 계약)
  openai: null,                    // 하드코딩 기본 없음 — 어드민이 상위 모델 직접 선택 필수
}

export interface ProviderConfig { id: ProviderId; apiKey: string; model: string }

/** META(Record<string,unknown>)에서 사용 가능한 프로바이더 목록. 키 없음 → 제외, 모델 없음 → DEFAULT_MODELS 폴백(openai는 모델 미설정 시 제외) */
export function getAvailableProviders(meta: Record<string, unknown>): ProviderConfig[]

/** 특정 프로바이더 설정. 키/모델 미충족 시 null */
export function getProviderConfig(meta: Record<string, unknown>, id: ProviderId): ProviderConfig | null

export const META_DEFAULT_PROVIDER_KEY = 'ai_chat_default_provider'

/** 신규 대화 기본 프로바이더(META `ai_chat_default_provider`, 04 §7).
 *  설정값이 available이면 그 설정, 미설정/미가용이면 첫 available, available 0개면 null.
 *  createConversation 기본값(새 대화 버튼 프리셀렉트)의 단일 소스. */
export function getDefaultProvider(meta: Record<string, unknown>): ProviderConfig | null
```
META 조회 자체는 호출측(route/action)에서 `org_content` `key='META'`를 `createAdminClient()`로 읽어 전달 — `token-logger.ts:39-41`과 동일 쿼리 패턴. registry는 순수 함수로 유지해 단위테스트 가능하게 한다.

프로바이더 인스턴스 매핑도 여기서:
```ts
export function getProvider(id: ProviderId): ChatProvider   // providers/* 매핑
```

### 4-4. `providers/gemini.ts`

- 엔드포인트: `POST ${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse` (`GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'`), 헤더 `{ 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }` — `db-chat/route.ts:132-143` 검증 패턴 그대로.
- 메시지 매핑(순수 함수로 export — 테스트 대상): `toGeminiContents(turns): Array<{role:'user'|'model', parts:[{text}]}>` — `assistant→'model'`. system은 `system_instruction: { parts: [{ text }] }`.
- 스트리밍 파싱: `res.body.getReader()` + `createSseParser()` → 이벤트마다 `candidates[0].content.parts[0].text`를 `onDelta`로. `usageMetadata{promptTokenCount,candidatesTokenCount,totalTokenCount}`를 usage로 (마지막 이벤트 값 우선).
- `generationConfig: { maxOutputTokens }` (기본 8192). db-chat과 달리 `responseMimeType`은 지정하지 않음(자유 마크다운 응답).
- capabilities: `{ vision: true, tools: true, thinking: false, defaultMaxOutputTokens: 8192 }` (선언 — 소비는 세션 2·3).
- abort: `fetch(url, { signal })` → AbortError catch 시 `{ stopped: true }` 반환.
- `listModels`: `GET ${GEMINI_API_BASE}/models` 헤더 `x-goog-api-key` — `actions.ts:138-141 getGeminiModels` 검증 패턴 재사용.

### 4-5. `providers/claude.ts`

```ts
import Anthropic from '@anthropic-ai/sdk'
export function toClaudeMessages(turns: ChatTurn[]): Array<{ role: 'user'|'assistant'; content: string }>  // 순수, 테스트 대상
```
- `new Anthropic({ apiKey })` → `client.messages.stream({ model, max_tokens: maxOutputTokens ?? 32000, system, messages: toClaudeMessages(turns), thinking: { type: 'adaptive' } })` — thinking은 adaptive(요약 thinking 스트림 수신).
- capabilities: `{ vision: true, tools: true, thinking: true, defaultMaxOutputTokens: 32000 }`.
- 이벤트 처리: `content_block_delta`에서 `delta.type === 'text_delta'` → `onDelta(delta.text)`, `delta.type === 'thinking_delta'` → `onThinking(delta.thinking)`.
- usage: `message_start`의 `message.usage.input_tokens` + `message_delta`의 `usage.output_tokens` → `{promptTokens, outputTokens, totalTokens: 합}`.
- abort: `params.signal.addEventListener('abort', () => stream.abort())` → 부분 텍스트로 `{ stopped: true }`.
- 기본 모델: `claude-opus-4-8` (registry DEFAULT_MODELS).
- `listModels`: `client.models.list()` → id 배열.

### 4-6. `providers/openai.ts`

```ts
import OpenAI from 'openai'
export function toOpenAiMessages(system: string | undefined, turns: ChatTurn[]):
  Array<{ role: 'system'|'user'|'assistant'; content: string }>  // 순수, 테스트 대상 — system을 첫 원소로
```
- `new OpenAI({ apiKey })` → `client.chat.completions.create({ model, messages, stream: true, stream_options: { include_usage: true }, max_completion_tokens: maxOutputTokens ?? 16384 })`.
- `for await (const chunk of stream)`: `chunk.choices[0]?.delta?.content` → `onDelta`. 마지막 usage 청크의 `chunk.usage.{prompt_tokens,completion_tokens,total_tokens}` → usage.
- abort: `signal` abort 시 `stream.controller.abort()` → `{ stopped: true }`.
- capabilities: `{ vision: true, tools: false, thinking: false, defaultMaxOutputTokens: 16384 }` (chat.completions — server tool 미지원).
- 기본 모델 없음 — 어드민이 `/admin/settings`에서 `getOpenAiModels()` 목록 중 상위 모델을 직접 선택(§7-4).
- `listModels`: `client.models.list()` → `gpt`/`o` 계열 필터.

### 4-7. `use-sse-chat.ts` — 클라이언트 훅 (`'use client'`)

```ts
export interface SseChatEvents {
  onDelta(text: string): void
  onThinking(text: string): void
  onDone(payload: { messageId: string }): void
  onError(message: string): void
}
export function useSseChat(): {
  send(body: { conversationId: string; content: string }, ev: SseChatEvents): Promise<void>
  stop(): void            // AbortController.abort()
  streaming: boolean
}
```
동작: `fetch('/api/admin/ai-chat/stream', { method:'POST', body: JSON.stringify(...), signal: controller.signal })` → `res.ok` 아니면 JSON 에러 파싱 후 `onError` → `res.body.getReader()` + `TextDecoder` + `createSseParser()` 루프 → 이벤트 분기: `delta`/`thinking`/`done.error`/`done.messageId`. `stop()`은 abort — 서버가 부분 저장(§5-1), 클라는 스트림 종료 후 `getMessages` 재조회 없이 로컬 누적분을 확정 표시하고 새로고침 시 서버 저장분과 일치.

---

## 5. API / 서버 액션 스펙

### 5-1. `POST /api/admin/ai-chat/stream` — `apps/web/app/api/admin/ai-chat/stream/route.ts`

**요청** (JSON):
```ts
{ conversationId: string /* uuid */, content: string /* 1~32000자, trim 후 비면 400 */ }
```

**처리 순서**:
1. `const { user, error } = await requireAdminApi()` → `if (error) return error` (401/403 — `lib/auth/requireAdminApi.ts` 검증 시그니처).
2. body 수동 검증 → 위반 시 `NextResponse.json({error},{status:400})`.
3. `createAdminClient()`로 `ai_conversations` 조회: `id=conversationId and user_id=user.id and deleted_at is null` → 없으면 404.
4. META 조회 → `getProviderConfig(meta, conversation.provider)` → null이면 500 `'AI 키가 설정되지 않았습니다'` (db-chat:121 문구 컨벤션).
5. 사용자 메시지 insert (`role:'user', content`) — 트리거가 대화 `updated_at` 갱신.
6. 히스토리 로드: 해당 대화 메시지 `created_at asc` 최근 **40턴**(멀티턴 컨텍스트 상한 — 세션 2 이후는 `buildActiveThread()` 적용 후 동일 상한), `error is null`인 것만 → `ChatTurn[]` 매핑.
7. `new ReadableStream({ async start(controller) })` 안에서 `getProvider(provider).streamChat({..., signal: req.signal, onDelta, onThinking })`:
   - `onDelta` → `data: {"delta":"..."}\n\n` enqueue
   - `onThinking` → `data: {"thinking":"..."}\n\n` enqueue
8. 완료 시(정상 or stopped):
   - assistant 메시지 insert: `{ role:'assistant', content: result.text, thinking: result.thinking, provider, model, prompt_tokens, output_tokens, stopped: result.stopped }` → `messageId` 확보.
   - `logTokenUsage({ userId: user.id, feature: 'ai-chat', model, provider, promptTokens, outputTokens, totalTokens })` — fire-and-forget(기존 시그니처 + §2-3 provider 확장).
   - 자동 제목(§5-2 autoTitle 내부 로직을 직접 호출, fire-and-forget): 대화 `title === '새 대화'`이고 이번이 첫 어시스턴트 응답일 때만.
   - `data: {"done":true,"messageId":"<uuid>"}\n\n` enqueue 후 `controller.close()`.
9. 프로바이더 예외 시: assistant 메시지를 `error` 채워 insert → `data: {"done":true,"error":"..."}\n\n` → close. (봉투는 db-chat 에러 이벤트와 동일 형태.)
10. 클라 이탈/Stop(`req.signal` abort): 7의 streamChat이 `stopped:true`로 반환 → 8 경로로 부분 내용 저장(연결이 끊겨 이벤트 전송은 불가하지만 저장은 수행).

**응답 헤더** (db-chat:248-254 검증값 그대로):
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**SSE 봉투 (통일 계약)**:
| 이벤트 | 형식 |
|---|---|
| 텍스트 델타 | `data: {"delta":"..."}\n\n` |
| thinking 델타 (Claude) | `data: {"thinking":"..."}\n\n` |
| 완료 | `data: {"done":true,"messageId":"<uuid>"}\n\n` |
| 에러 | `data: {"done":true,"error":"메시지"}\n\n` |

### 5-2. 서버 액션 — `apps/web/app/admin/ai-chat/actions.ts` (`'use server'`)

공통: 모든 액션은 `requireAdmin()`(`lib/auth/requireAdmin.ts` — admin 아니면 redirect, adminClient 반환. `settings/actions.ts:47` 사용 패턴)으로 게이트 후 `user_id = 본인` 스코프로만 조작. 반환 컨벤션은 기존 `{ ok: boolean; error?: string }` (`saveGeminiKey` 검증 패턴).

```ts
// Create
export async function createConversation(input: { provider: AiChatProviderId; model: string }):
  Promise<{ ok: boolean; id?: string; error?: string }>
// META 검증: getProviderConfig 통과 못 하는 provider/model이면 { ok:false }

// Read (목록 — 핀 우선 → updated_at desc, 커서 페이지네이션)
export async function listConversations(input?: { cursor?: string /* updated_at ISO */; limit?: number /* 기본 30, 최대 50 */ }):
  Promise<{ ok: boolean; items?: AiChatConversation[]; nextCursor?: string | null; error?: string }>
// where deleted_at is null · order pinned desc, updated_at desc · cursor = 마지막 행 updated_at (핀 행 이후 구간)

// Read (메시지 — 최신 페이지부터 위로 로드)
export async function getMessages(input: { conversationId: string; before?: string /* created_at ISO */; limit?: number /* 기본 50 */ }):
  Promise<{ ok: boolean; items?: AiChatMessage[]; nextCursor?: string | null; error?: string }>
// created_at desc + before 커서로 limit+1 조회 → 반전(asc)해 반환, nextCursor = 더 오래된 페이지 존재 시 경계 created_at

// Update
export async function renameConversation(id: string, title: string): Promise<{ ok: boolean; error?: string }>   // 1~100자
export async function togglePin(id: string): Promise<{ ok: boolean; pinned?: boolean; error?: string }>
export async function updateConversationModel(id: string, provider: AiChatProviderId, model: string):
  Promise<{ ok: boolean; error?: string }>   // 대화 중 모델 전환 — getProviderConfig 검증

// Delete / 복원 (소프트삭제)
export async function softDeleteConversation(id: string): Promise<{ ok: boolean; error?: string }>  // deleted_at = now()
export async function restoreConversation(id: string): Promise<{ ok: boolean; error?: string }>     // deleted_at = null
// UI: 삭제 직후 목록 상단 배너/토스트 "삭제됨 — 되돌리기" (복원 어포던스)

// 자동 제목
export async function autoTitle(conversationId: string): Promise<{ ok: boolean; title?: string; error?: string }>
```

**autoTitle 로직**: 첫 user+assistant 페어를 입력으로, 해당 대화 프로바이더의 **비스트림** 호출(Gemini `:generateContent` / Claude `messages.create` max_tokens 64 / OpenAI 비스트림)로 "다음 대화의 제목을 한국어 15자 이내 명사구로" 생성 → `title` 업데이트 → `logTokenUsage({feature:'ai-chat', ...})`. **실패 시 폴백**: 첫 사용자 메시지 앞 30자 + '…'. 어떤 경우에도 throw 하지 않음.

---

## 6. UI 컴포넌트 트리

```
apps/web/app/admin/ai-chat/
├── page.tsx                  # 서버 컴포넌트
├── actions.ts                # §5-2
├── AiChatClient.tsx          # 'use client' 루트 — URL 동기화·상태 허브
├── ConversationSidebar.tsx   # 대화 목록 + 새 대화
├── MessageList.tsx           # 메시지 스크롤 영역 + 자동스크롤
├── MessageBubble.tsx         # 개별 메시지 (복사·thinking·stopped·error)
├── Composer.tsx              # 입력 + 전송/Stop + 모델선택
└── MarkdownMessage.tsx       # react-markdown 렌더러 (코드블록 복사)
```

### 6-1. `page.tsx` (서버)
- `await requireAdmin()` — admin/layout 게이팅 위에 **이중검증 컨벤션** 준수.
- 초기 데이터 병렬 로드: `listConversations()` 1페이지 + `searchParams.c`가 있으면 해당 대화 `getMessages()` 1페이지 + META에서 `getAvailableProviders(meta)` + `getDefaultProvider(meta)`(새 대화 기본 프로바이더/모델) (키는 서버에만 — 클라에는 `{id,label,model}`만 전달).
- 렌더: `<AiChatClient initialConversations={...} initialMessages={...} initialConversationId={searchParams.c ?? null} providers={...} />`

### 6-2. `AiChatClient.tsx`
- props: 위 4개. 상태: `conversations`, `selectedId`, `messages`, `streamBuffer {delta, thinking}`, `sidebarOpen`(모바일).
- **URL 동기화**: 대화 선택/생성 시 `router.replace(`/admin/ai-chat?c=${id}`, { scroll:false })` — URL state 컨벤션(공유/새로고침 복원).
- `useSseChat()` 소유 — 전송 시 낙관적으로 user 메시지 append → 스트림 델타를 `streamBuffer`에 누적 → done에서 assistant 메시지로 확정.
- 레이아웃: `responsive-grid` 금지 대상 아님 — 데스크탑 2컬럼(사이드바 280px 고정 + 채팅 1fr), 모바일은 사이드바를 드로어로(`mobile-only` 토글 버튼). 인라인 `<style>` 금지 — 필요한 신규 클래스는 `globals.css`에 `ai-chat-*` 접두로 추가(토큰만 사용).

### 6-3. `ConversationSidebar.tsx`
- props: `{ conversations, selectedId, providers, onSelect(id), onCreate(provider,model), onRename(id,title), onDelete(id), onRestore(id), onTogglePin(id), onLoadMore() }`
- 상단 **"+ 새 대화" 버튼**(`btn-primary`, min-height 44px) — FAB 미도입 결정(§7-3)의 채택 진입점. 새 대화의 기본 provider/model = `getDefaultProvider(meta)` 결과(서버에서 계산해 props로 전달).
- 항목: 제목(1줄 ellipsis) + 프로바이더 라벨 뱃지(`NbBadge`) + 핀 아이콘. 컨텍스트 액션(hover/… 메뉴): 이름변경(인라인 input `input-field`) / 핀 / 삭제.
- 삭제 시 항목 자리에 5초간 "삭제됨 — 되돌리기" 인라인 배너(복원). 하단 "더 보기"(커서 페이지네이션).
- 빈 상태: "대화가 없습니다 — 새 대화를 시작하세요".

### 6-4. `MessageList.tsx`
- props: `{ messages, streamBuffer, streaming, onLoadOlder() }`
- **자동스크롤**: 하단 sentinel ref + `useEffect`로 델타 수신마다 `scrollIntoView`. 단 사용자가 위로 스크롤 중(`scrollTop + clientHeight < scrollHeight - 80`)이면 중단, "↓ 최신으로" 플로팅 버튼 표시.
- 상단 도달 시 `onLoadOlder()`(getMessages before 커서) — prepend 시 스크롤 위치 보존.
- 3종 UI: 로딩=`AXDotLoader`(초기 메시지 로드), 빈=안내 카피 + 예시 프롬프트 3개 버튼, 에러=`--danger-bg/--danger-border` 토큰 배너 + 재시도 버튼.

### 6-5. `MessageBubble.tsx`
- props: `{ message: AiChatMessage | { role, content, thinking, streaming: true } }`
- user: 우측 정렬 plain text(개행 유지). assistant: 좌측, `MarkdownMessage` 렌더.
- thinking 존재 시 접이식 "생각 과정" 토글(기본 접힘, 스트리밍 중엔 펼침).
- 메시지 복사 버튼(`navigator.clipboard.writeText(content)` + 1.5초 체크 아이콘 피드백).
- `stopped=true` → "⏹ 중단됨" 뱃지, `error` → 에러 토큰 색 배너.
- 스트리밍 중 어시스턴트 말풍선에는 `AXDotLoader size="sm"` 커서.

### 6-6. `Composer.tsx`
- props: `{ streaming, currentProvider, currentModel, providers, onSend(content), onStop(), onChangeModel(provider, model) }`
- `<textarea className="input-field">` 자동 높이(최대 8줄), Enter=전송 / Shift+Enter=개행, IME 조합 중(`e.nativeEvent.isComposing`) 전송 금지.
- 전송 버튼 ↔ 스트리밍 중 **Stop 버튼**(동일 위치 토글, min 44px).
- 좌하단 프로바이더/모델 셀렉트(`input-field`) — 변경 시 `updateConversationModel` 호출(대화 없으면 새 대화 기본값으로만 보관). 키 미등록 프로바이더는 disabled + "설정에서 키 등록" 안내.

### 6-7. `MarkdownMessage.tsx`
- `react-markdown` + `remarkPlugins:[remarkGfm]` + `rehypePlugins:[rehypeHighlight]`.
- `components.code` 오버라이드: 블록 코드 → 헤더(언어 라벨 + 복사 버튼) + `<pre className="ai-chat-code">` (`overflow-x:auto` 자체 스크롤). 인라인 코드 → `--surface-bg`/`--border-light` 토큰 스타일.
- `globals.css`에 추가: `.ai-chat-code` + `.hljs-keyword/.hljs-string/.hljs-comment/.hljs-number/.hljs-title/.hljs-attr` 최소 매핑을 **디자인 토큰**(`--info`, `--success`, `--text-muted`, `--warning` 등)으로 정의 → `[data-theme]` 전환 자동 대응. highlight.js 배포 테마 CSS import 금지(하드코딩 색 유입 차단).
- a 태그 `target="_blank" rel="noreferrer"`. 이미지/raw HTML 비활성(`skipHtml`) — XSS 면적 제거.

---

## 7. 통합 상세

### 7-1. ADMIN_NAV_GROUPS 삽입 (`apps/web/app/admin/layout.tsx` — 검증된 현재 코드 기준)

7–20행 lucide import에 `MessageSquare` 추가, 44행 `/admin/ai-prompts` 항목 **바로 다음 줄**에 삽입:

```tsx
  {
    label: 'API · 시스템',
    items: [
      { href: '/admin/api', label: 'API 관리', icon: <Key size={16} /> },
      { href: '/admin/ai-usage', label: 'AI 사용량', icon: <Bot size={16} /> },
      { href: '/admin/ai-prompts', label: 'AI 프롬프트', icon: <Bot size={16} /> },
      { href: '/admin/ai-chat', label: 'AI 채팅', icon: <MessageSquare size={16} /> },  // ← 신규 (45행에 삽입)
      { href: '/admin/data-quality', label: '데이터 품질', icon: <ShieldCheck size={16} /> },
      { href: '/admin/settings', label: '시스템 설정', icon: <SlidersHorizontal size={16} /> },
    ],
  },
```
`app/admin/ai-chat/`에 두므로 admin/layout의 role 게이팅이 자동 적용되고, page.tsx의 `requireAdmin()`이 이중검증(컨벤션).

### 7-2. "최근 대화" 렌더 — 결정
- **(A) 채택**: 최근 대화는 **`/admin/ai-chat` 페이지 내 `ConversationSidebar`**(§6-3)에서 렌더.
- (B) 기각(확정): 글로벌 어드민 네비(MobileShell `groups`)는 정적 `NavGroup[]` 선언 구조(검증됨) — 동적 대화 목록을 넣으려면 `MobileShell` 공용 컴포넌트를 개조해야 하며, 이는 (member) 전 화면에 영향(Surgical Changes 위반 리스크). 대화 목록 렌더 위치는 (A) 페이지 내 사이드바로 **확정**.

### 7-3. FAB "새 채팅" — 결정 (권고안 명시)
**제약(검증됨)**: `admin/layout.tsx`는 `MobileShell items={[]}`로 QuickAddFab을 렌더하지 않고, `components/ui/QuickAddFab.tsx:32`가 `/admin` 경로에서 null 반환 — 어드민 화면에는 FAB 자체가 없음.
- **(A) 채택·권고**: "새 대화" 진입점은 ① `ConversationSidebar` 상단 버튼 ② 빈 상태 화면 중앙 버튼 ③ 모바일에서는 채팅 헤더의 + 아이콘. 표준적이고 침습 없음.
- (B) 기각: admin 레이아웃에 QuickAddFab 도입 + ai-chat 액션 — QuickAddFab의 `/admin` null 가드 제거와 admin 전 화면 FAB 노출이라는 부작용(다른 어드민 화면에 무관한 FAB) 대비 이익 없음.

### 7-4. 어드민 설정 — Claude / OpenAI 섹션 (`GeminiSettings` 복제 기준, 검증된 패턴)

**`apps/web/app/admin/settings/actions.ts`에 추가** (기존 `getMetaValue(client)`/`setMetaValue(client, meta)` 23–41행 재사용):

```ts
const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1'
const OPENAI_API_BASE = 'https://api.openai.com/v1'

export async function saveClaudeKey(formData: FormData): Promise<{ ok: boolean; error?: string }>
// = saveGeminiKey(43-56행)와 동일 골격, META 키 'claude_api_key'
export async function saveClaudeModel(model: string): Promise<{ ok: boolean; error?: string }>
// = saveGeminiModel(156-169행) 골격, META 키 'claude_model'
export async function getClaudeModels(): Promise<{ ok: boolean; models?: string[]; error?: string }>
// GET ${ANTHROPIC_API_BASE}/models, 헤더 { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } → data[].id

export async function saveOpenAiKey(formData: FormData): Promise<{ ok: boolean; error?: string }>   // 'openai_api_key'
export async function saveOpenAiModel(model: string): Promise<{ ok: boolean; error?: string }>      // 'openai_model'
export async function getOpenAiModels(): Promise<{ ok: boolean; models?: string[]; error?: string }>
// GET ${OPENAI_API_BASE}/models, 헤더 { Authorization: `Bearer ${apiKey}` } → data[].id 중 gpt/o 계열 필터

export async function saveAiChatDefaultProvider(provider: AiChatProviderId | ''): Promise<{ ok: boolean; error?: string }>
// META 키 'ai_chat_default_provider' — 빈 값이면 키 제거(폴백=첫 available). registry getDefaultProvider가 소비(04 §7)
```

**컴포넌트**: `ClaudeSettings.tsx` / `OpenAiSettings.tsx` — `GeminiSettings.tsx`(props `hasKey/maskedKey/savedModel`) + `GeminiModelPicker.tsx` 구조 복제(키 저장 폼 + 모델 목록 조회/선택). Claude 모델 피커는 `claude-opus-4-8`을 권장 기본으로 프리셀렉트.

**`page.tsx`**: 51–55행 패턴대로 META에서 `claude_api_key`/`claude_model`, `openai_api_key`/`openai_model`을 읽어 각 `{hasKey, maskedKey(기존 maskKey 재사용), savedModel}` 파생 → "AI 모델 연동" 섹션(99–102행) 내부에 `<GeminiSettings/>` 아래로 `<ClaudeSettings/>`, `<OpenAiSettings/>` 추가. 섹션 말미에 **기본 프로바이더 셀렉트**(`input-field`, 가용 프로바이더만 노출 + "자동(첫 가용)" 옵션) — `saveAiChatDefaultProvider` 호출.

---

## 8. 테스트 전략

### 8-1. 단위테스트 (node:test, `--experimental-strip-types`)

| 파일 | 케이스 |
|---|---|
| `apps/web/lib/ai-chat/registry.test.ts` | ① 키 3개 모두 있을 때 available 3개 ② gemini 키만 → 1개 + 모델 폴백 `gemini-2.0-flash` ③ claude 키만·모델 미설정 → 모델 `claude-opus-4-8` 폴백 ④ openai 키 있음+모델 미설정 → **제외** ⑤ 빈 META → 빈 배열 ⑥ `getProviderConfig` 미가용 프로바이더 → null ⑦ `getDefaultProvider` — 설정값이 가용이면 해당 설정, 미설정/미가용이면 첫 available, 빈 META → null |
| `apps/web/lib/ai-chat/map-turns.test.ts` | `toGeminiContents`(assistant→'model' 매핑, parts 구조) / `toClaudeMessages`(role 보존) / `toOpenAiMessages`(system 첫 원소, system 없으면 미포함) — 빈 배열·단일 턴·교차 턴 |
| `apps/web/lib/ai-chat/sse.test.ts` | `createSseParser`: ① 완결 이벤트 2개 한 청크 ② 이벤트가 청크 경계에서 잘림(버퍼 이월) ③ `data: ` 아닌 라인 무시 ④ malformed JSON skip ⑤ flush 잔여 처리 |

### 8-2. 등록·게이트
- **`apps/web/package.json` `"test"` 스크립트(10행)의 파일 목록 끝에 위 3개 경로를 수기 추가** — 이 프로젝트는 자동 수집이 아니라 명시 목록(검증됨). 예: `... \"lib/reports/org-scope-key.test.ts\" \"lib/ai-chat/registry.test.ts\" \"lib/ai-chat/map-turns.test.ts\" \"lib/ai-chat/sse.test.ts\"`.
- typecheck: `cd apps/web && pnpm exec tsc --noEmit` (tsconfig가 `**/*.test.ts` 제외 — 기존 컨벤션).
- lint: `cd apps/web && pnpm lint`.
- 디자인 가드: `pnpm design:check` (신규 globals.css 추가분 포함 hex/치수 하드코딩 0 확인).
- 프로바이더 실호출/스트리밍 E2E는 키 의존이므로 세션 1 자동화 제외 — 순수 함수(파서·매퍼·registry)로 로직을 밀어내 커버.

---

## 9. 완료기준 체크리스트 (`04-completion-criteria` 역할 — EXEC-001 게이트 · 배치 1 = 확정 완성 스펙의 해당 항목 100%)

**데이터/보안**
- [ ] `150_ai_chat.sql` 작성 완료 (테이블 2 + RLS 2정책 + 트리거 2 + 인덱스 2 + `ai_token_logs.provider`)
- [ ] RLS = admin 게이트 + owner 스코프 (149 패턴), default-deny
- [ ] `types/database.ts`: `'ai-chat'` union 추가(404행) + `AiTokenLog.provider` + `AiChatConversation`/`AiChatMessage`
- [ ] `token-logger.ts` LogParams `provider?` 확장, 기존 호출처 무수정 통과

**대화 관리 (Feature Defaults)**
- [ ] Create: `createConversation` + 새 대화 버튼(사이드바/빈상태/모바일 헤더)
- [ ] Read: `listConversations`(핀→최신 정렬, 커서 페이지네이션) + `getMessages`(before 커서, 위로 로드)
- [ ] Update: `renameConversation` / `togglePin` / `updateConversationModel`
- [ ] Delete: `softDeleteConversation`(deleted_at) + `restoreConversation`(되돌리기 UI)
- [ ] 검색은 배치 2(세션 2) 구현 — 스펙 확정(§1-4 배치 분할), 누락 아님
- [ ] URL 동기화: `?c=<id>` 선택/생성/새로고침/공유 복원

**채팅 코어**
- [ ] 멀티턴(최근 40턴 컨텍스트) 스트리밍 응답 — 통일 SSE 봉투(delta/thinking/done/error)
- [ ] Stop: 클라 abort → 서버 부분 저장(stopped=true) → 재방문 시 "중단됨" 표시
- [ ] 마크다운+GFM+코드블록(언어 라벨·복사 버튼·자체 가로스크롤) — `.hljs-*` 토큰 매핑, 하드코딩 색 0
- [ ] 메시지 복사 버튼 + 피드백
- [ ] 자동 제목: AI 생성 + 실패 시 30자 절삭 폴백

**프로바이더**
- [ ] Gemini(REST SSE)/Claude(`messages.stream`+adaptive thinking)/OpenAI(stream+usage) 3구현 + 공통 `ChatProvider` 인터페이스
- [ ] capabilities 4필드 `{vision, tools, thinking, defaultMaxOutputTokens}` 선언(04 §4 확정값 — vision/tools는 선언만)
- [ ] 기본 모델: claude=`claude-opus-4-8`, gemini=META `gemini_model`(폴백 gemini-2.0-flash), openai=어드민 선택 필수
- [ ] 기본 프로바이더: registry `getDefaultProvider(meta)`(META `ai_chat_default_provider`, 폴백 첫 available) + 설정 UI(`saveAiChatDefaultProvider`)
- [ ] 대화 중 프로바이더/모델 전환(Composer 셀렉트)
- [ ] 토큰 로깅: 모든 스트림 완료/중단/autoTitle에 `feature:'ai-chat'` + provider 기록

**통합/UI**
- [ ] `ADMIN_NAV_GROUPS`에 `/admin/ai-chat`(MessageSquare, ai-prompts 다음) + lucide import
- [ ] 최근 대화 = 페이지 내 사이드바(결정 §7-2), FAB 미도입·새 대화 버튼 채택(결정 §7-3) 반영
- [ ] `/admin/settings`에 Claude/OpenAI 키·모델 섹션(actions 7종 + 컴포넌트 2종 + page props) + 기본 프로바이더 셀렉트
- [ ] 로딩(`AXDotLoader`)/빈/에러 3종, 자동스크롤(+사용자 스크롤 존중), 반응형(모바일 드로어 사이드바), 다크/라이트 토큰 대응, `input-field`/`label`/`btn-primary`/min-44px 준수, 인라인 `<style>` 0

**검증 게이트 (자동화)**
- [ ] `pnpm exec tsc --noEmit` 통과
- [ ] `pnpm lint` 통과
- [ ] `pnpm test` 통과 (신규 3개 테스트 파일 목록 등록 포함)
- [ ] `pnpm design:check` 통과
- [ ] 🟥 DC-REV 코드리뷰 PASS + 🟥 DC-SEC 보안리뷰 PASS(RLS·키 노출·SSE 인젝션·XSS 면적)

---

## 10. 배포 핸드오프 (EXEC-003 — 사용자 실행 항목)

아래 2개는 사용자 인증/로컬 시크릿(PGPASSWORD, git 원격 권한)이 필요하므로 **사용자에게 위임**한다. 그 외 모든 구현·검증은 에이전트가 직접 수행.

1. **마이그레이션 적용**: `PGPASSWORD='...' ./scripts/migrate.sh 150_ai_chat.sql` → `./scripts/migrate.sh --status`로 150 반영 확인.
2. **git push**: 커밋(`v{버전}: AI 채팅 세션1 — 기반+핵심 채팅 claude` — 버전은 커밋 전 `git log --oneline -5`로 확정, 루트/`apps/web` package.json + CLAUDE.md + AGENTS.md 버전 라인 동기화)은 에이전트가 수행하고 push만 사용자.
3. 배포 후 사용자 작업: `/admin/settings`에서 Claude/OpenAI API 키 등록 + 모델 선택 → `/admin/ai-chat` 스모크(새 대화→스트리밍→Stop→새로고침 복원).
