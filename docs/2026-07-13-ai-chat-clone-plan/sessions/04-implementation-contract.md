# 04 — 공용 구현 계약 (SSOT) · AI 채팅(Claude 클론) 3세션 공통

> **지위**: 세션 1·2·3 상세설계와 00-loop-runbook의 "정합성 계약"을 대체·확장하는 **단일 구현 계약**. 세션 문서 간 명명·시그니처가 이 문서와 어긋나면 **이 문서가 우선**한다.
> 기준 코드베이스: v0.7.294 · 작성일 2026-07-13. `types/database.ts` 384–416행, `lib/token-logger.ts` 4–25행 실코드 재검증 완료.
> **설계 문서 — 코드 아님.** 각 세션 루프가 구현 시 이 계약의 식별자·시그니처를 그대로 사용한다.

---

## 1. 명명 표준 (Naming SSOT)

### 1-1. DB 테이블 (전부 `ai_` 접두 — `ai_chat_*` 표기 폐기)

| 테이블 | 생성 세션 | 마이그레이션 |
|---|---|---|
| `ai_conversations` | S1 | 150 |
| `ai_messages` | S1 | 150 |
| `ai_attachments` | S2 | 151 |
| `ai_projects` | S3 | 152 |
| `ai_project_knowledge` | S3 | 152 |
| (기존) `ai_token_logs` | — | 011 생성, 150에서 `provider` 컬럼 추가 |

### 1-2. 마이그레이션 번호 (149가 현재 최신 — 순차 고정)

| 번호 | 파일명 | 세션 | 내용 |
|---|---|---|---|
| **150** | `150_ai_chat.sql` | S1 | ai_conversations · ai_messages · RLS · 트리거 · `ai_token_logs.provider` |
| **151** | `151_ai_chat_attachments.sql` | S2 | ai_attachments · `ai_messages.feedback`/`parent_message_id` · Storage 버킷/정책 |
| **152** | `152_ai_chat_projects.sql` | S3 | ai_projects · `ai_conversations.project_id` · ai_project_knowledge(+RPC) · `ai_messages.citations` |
| **153** | `153_ai_chat_share.sql` | S3 | admin 경계 내 공유 옵트인(확정): `ai_conversations.shared`/`share_token` |

### 1-3. RLS 정책명·트리거명·인덱스명 (실명 고정 — 참조 시 이 이름만 사용)

| 객체 | 이름 | 세션 |
|---|---|---|
| ai_conversations RLS | `aicc_admin_owner` | S1 |
| ai_messages RLS | `aicm_admin_owner` | S1 |
| ai_attachments RLS | `aia_owner_admin` | S2 |
| ai_projects RLS | `aip_owner_admin` | S3 |
| ai_project_knowledge RLS | `aipk_via_project` | S3 |
| Storage 정책 | `ai_chat_objects_select` / `ai_chat_objects_insert` / `ai_chat_objects_delete` | S2 |
| updated_at 트리거 | `trg_aicc_touch` (fn `fn_aicc_touch`) | S1 |
| 메시지→대화 touch 트리거 | `trg_aicm_touch_conv` (fn `fn_aicm_touch_conv`) | S1 |
| top-k RPC | `match_ai_project_knowledge(p_project_id, query_embedding, requester_id, match_count, min_sim)` | S3 |

> ⚠️ 폐기 표기(문서 잔존 오기 — 사용 금지): `aic_owner_admin`, `aim_via_conv`, `trg_aic_touch`.

### 1-4. 라우트 / 경로

| 구분 | 경로 | 세션 |
|---|---|---|
| 페이지 | `/admin/ai-chat` (URL state `?c=<conversationId>`) | S1 |
| 페이지 | `/admin/ai-chat/projects`, `/admin/ai-chat/projects/[id]` | S3 |
| 페이지 | `/admin/ai-chat/shared/[token]` (153) | S3 |
| API | `POST /api/admin/ai-chat/stream` | S1 (S2에서 확장) |
| API | `POST·DELETE /api/admin/ai-chat/upload` | S2 |
| API | `POST /api/admin/ai-chat/knowledge-upload` | S3 |
| API | `GET /api/admin/ai-chat/export?c=<id>` | S3 |
| 서버액션 | `apps/web/app/admin/ai-chat/actions.ts` (전 세션 단일 파일에 누적) | S1~S3 |
| lib | `apps/web/lib/ai-chat/` — `provider.ts` · `registry.ts` · `sse.ts` · `use-sse-chat.ts` · `providers/{gemini,claude,openai}.ts`(S1) · `attachments.ts` · `thread.ts` · `search.ts`(S2) · `artifacts.ts` · `knowledge.ts` · `export.ts` · `pricing.ts`(S3) |
| UI | `apps/web/app/admin/ai-chat/` — `page.tsx` · `AiChatClient.tsx` · `ConversationSidebar.tsx` · `MessageList.tsx` · `MessageBubble.tsx` · `Composer.tsx` · `MarkdownMessage.tsx`(S1) · `SystemPromptModal.tsx`(S2) · `ArtifactPanel.tsx` · `ArtifactChip.tsx` · `HtmlSandbox.tsx` · `CitationCards.tsx` · `projects/*`(S3) |
| Storage | 버킷 `ai-chat` (비공개, 20MB) · 경로 `{user_id}/{conversation_id}/{attachment_id}.{ext}` | S2 |

---

## 2. DB ERD + 컬럼 요약 + 세션별 생성 매트릭스

### 2-1. 텍스트 ERD

```
profiles (기존)
   │ 1
   ├──────────────< ai_conversations ────────────────┐
   │                  │ 1        │ n..1 (SET NULL)   │
   │                  │          └──> ai_projects >──┤ (owner: profiles)
   │                  │ n                │ 1         │
   │                  ▼                  ▼           │
   │              ai_messages     ai_project_knowledge
   │                  │ 1  ▲ self-FK (parent_message_id)
   │                  │ n  │
   │                  ▼    │
   ├──────────────< ai_attachments (message_id nullable — 전송 전 임시)
   │
   └──────────────< ai_token_logs (기존 011 + provider 컬럼[150])
                      ※ FK 아님 — feature='ai-chat' + provider 텍스트로 논리 연관
```

### 2-2. 컬럼 요약

**`ai_conversations`** (S1/150 기반, S3/152·153에서 컬럼 추가)
| 컬럼 | 타입 | 비고 | 세션 |
|---|---|---|---|
| id | uuid PK `gen_random_uuid()` | | S1 |
| user_id | uuid NOT NULL → profiles(id) CASCADE | 소유 admin | S1 |
| title | text NOT NULL default `'새 대화'` | | S1 |
| provider | text NOT NULL check in ('gemini','claude','openai') | | S1 |
| model | text NOT NULL | | S1 |
| system_prompt | text | **150에서 생성**(S1은 항상 null, S2가 편집 UI) | S1 |
| pinned | boolean NOT NULL default false | | S1 |
| created_at / updated_at | timestamptz NOT NULL | `trg_aicc_touch`·`trg_aicm_touch_conv` 갱신 | S1 |
| deleted_at | timestamptz | 소프트삭제 | S1 |
| project_id | uuid → ai_projects(id) ON DELETE SET NULL | | S3/152 |
| shared / share_token | boolean NOT NULL default false / text UNIQUE | admin 경계 내 공유 옵트인(확정) | S3/153 |

**`ai_messages`** (S1/150 기반, S2/151·S3/152에서 컬럼 추가)
| 컬럼 | 타입 | 비고 | 세션 |
|---|---|---|---|
| id | uuid PK | | S1 |
| conversation_id | uuid NOT NULL → ai_conversations CASCADE | | S1 |
| role | text check in ('user','assistant') | | S1 |
| content | text NOT NULL default '' | | S1 |
| thinking | text | Claude summarized thinking. **150에 존재 — S1이 저장(영속)** | S1 |
| provider / model | text / text | assistant 메시지 생성 출처 | S1 |
| prompt_tokens / output_tokens | integer | | S1 |
| stopped | boolean NOT NULL default false | Stop 부분응답 | S1 |
| error | text | 생성 실패 | S1 |
| created_at | timestamptz | | S1 |
| feedback | smallint check in (-1,1) | null=없음 | S2/151 |
| parent_message_id | uuid → ai_messages(id) | 편집분기 원본 참조(self-FK) | S2/151 |
| citations | jsonb | `[{url,title,snippet?}]` — web_search 출처 | S3/152 |

**`ai_attachments`** (S2/151)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK (서버 `crypto.randomUUID()` 선생성) | |
| message_id | uuid → ai_messages CASCADE, **nullable** | null=전송 전 임시 |
| conversation_id | uuid NOT NULL → ai_conversations CASCADE | |
| user_id | uuid NOT NULL → profiles CASCADE | Storage 1단계 폴더와 일치 |
| storage_path | text NOT NULL | `{user_id}/{conversation_id}/{id}.{ext}` — 원본명 미사용 |
| filename | text NOT NULL | 표시 전용(sanitize 저장) |
| mime / size_bytes | text / int check >0 | |
| kind | text check in ('image','pdf','document','other') | 업로드 API는 image/pdf/document만 발급 |
| created_at | timestamptz | |

**`ai_projects`** (S3/152): id · user_id(→profiles CASCADE) · name text NOT NULL · instructions text · created_at/updated_at · deleted_at(소프트삭제).
**`ai_project_knowledge`** (S3/152): id · project_id(→ai_projects CASCADE) · content text NOT NULL(≤2000자) · embedding vector(768) nullable · source text · chunk_index int default 0 · created_at. ivfflat `vector_cosine_ops` lists=100.
**`ai_token_logs`** (기존 + 150): `provider text` 추가(null=legacy Gemini). feature 컬럼은 **text** — `'ai-chat'` 값은 TS union 확장만으로 충분(DB 변경 불필요).

### 2-3. RLS 요약 (전 테이블 공통 골격 — default-deny, 149 org_weekly_reports 패턴)

```
admin 게이트: exists(select 1 from profiles where id=(select auth.uid()) and role='admin' and deleted_at is null)
owner 스코프: user_id = (select auth.uid())                          -- 직접 소유 테이블
            / exists(… ai_conversations c where c.id=conversation_id and c.user_id=auth.uid()) -- ai_messages
            / exists(… ai_projects p where p.id=project_id and p.user_id=auth.uid() and p.deleted_at is null) -- knowledge
```
- USING과 WITH CHECK 모두에 동일 조건. 서버 write는 `createAdminClient()`(service_role, RLS 우회) + 액션/라우트에서 소유 검증 선행 — RLS는 방어적 이중화.
- Storage: 버킷 비공개 + `(storage.foldername(name))[1] = auth.uid()::text` + admin 게이트 (select/insert/delete 3정책).
- RPC `match_ai_project_knowledge`: admin 클라이언트 호출(RLS 우회)이므로 함수 본문에 `requester_id` 소유·admin 검증 내장.
- 153에서도 **RLS 완화 금지** — 공유 열람은 서버가 `shared=true AND share_token=?` 명시 검증 후 read-only 제공.

### 2-4. 세션별 생성 매트릭스 (어느 세션이 무엇을 만드는가)

| 객체 | 150(S1) | 151(S2) | 152(S3) | 153(S3) |
|---|---|---|---|---|
| ai_token_logs.provider | ✅ 추가 | | | |
| ai_conversations (전 컬럼: system_prompt·pinned 포함) | ✅ 생성 | | +project_id | +shared, share_token |
| ai_messages (thinking·stopped·error 포함) | ✅ 생성 | +feedback, parent_message_id | +citations | |
| ai_attachments | | ✅ 생성 | | |
| Storage 버킷 `ai-chat` + 정책 3종 | | ✅ 생성 | | |
| ai_projects / ai_project_knowledge / RPC | | | ✅ 생성 | |
| 트리거 2종 + RLS(aicc/aicm) | ✅ | RLS(aia) | RLS(aip/aipk) | |

> S2·S3는 **컬럼 추가만** — S1 생성 테이블/컬럼을 재정의하지 않는다. 특히 `system_prompt`·`pinned`·`thinking`은 150 소속(151에서 추가 아님).

---

## 3. TypeScript 타입 계약 — `apps/web/types/database.ts` 최종 통합본 (S1~S3 누적)

**삽입 위치(실코드 검증)**: `AiFeature` union 마지막 멤버 `'meeting_extract'`(403행) 뒤에 `| 'ai-chat'` 추가. `AiTokenLog`(405–416행)의 `model` 필드 뒤에 `provider: string | null` 추가. 신규 타입은 `AiTokenLog` 뒤에 배치.

```ts
// ── AiFeature union (S1) ──
export type AiFeature =
  /* 기존 19개 유지 */ | 'meeting_extract'
  | 'ai-chat'                                  // S1 — DB는 text 컬럼이라 마이그레이션 불필요

// ── AiTokenLog (S1) ── model 필드 뒤에 1필드 추가
export interface AiTokenLog {
  // ...기존 필드...
  provider: string | null                      // S1/150 — null=legacy Gemini
}

// ── 신규 (S1) ──
export type AiChatProviderId = 'gemini' | 'claude' | 'openai'

export interface AiChatConversation {
  id: string
  user_id: string
  title: string
  provider: AiChatProviderId
  model: string
  system_prompt: string | null                 // S1/150 컬럼 (S2에서 편집 UI)
  pinned: boolean
  project_id: string | null                    // S3/152 — S1·S2 시점에는 필드 자체 미존재(152 후 추가)
  created_at: string
  updated_at: string
  deleted_at: string | null
  shared: boolean                              // S3/153 — admin 경계 내 공유 옵트인
  share_token: string | null                   // S3/153
}

export interface AiChatMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  thinking: string | null                      // S1 — 영속(150 컬럼, 스트림 완료 시 저장)
  provider: string | null
  model: string | null
  prompt_tokens: number | null
  output_tokens: number | null
  stopped: boolean
  error: string | null
  created_at: string
  feedback: -1 | 1 | null                      // S2/151
  parent_message_id: string | null             // S2/151 — 편집분기
  citations: AiChatCitation[] | null           // S3/152 — web_search 출처
}

export interface AiChatCitation {              // S3
  url: string
  title: string
  snippet?: string
}

export interface AiChatAttachment {            // S2/151
  id: string
  message_id: string | null                    // null = 전송 전 임시
  conversation_id: string
  user_id: string
  storage_path: string
  filename: string
  mime: string
  size_bytes: number
  kind: 'image' | 'pdf' | 'document' | 'other' // DB check와 동일('other'는 예약 — 업로드 API는 미발급)
  created_at: string
}

export interface AiChatProject {               // S3/152
  id: string
  user_id: string
  name: string
  instructions: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface AiChatProjectKnowledge {      // S3/152
  id: string
  project_id: string
  content: string
  embedding: string | null                     // vector(768) — pg 직렬화 문자열, 앱은 직접 조작하지 않음
  source: string | null
  chunk_index: number
  created_at: string
}
```

**세션별 추가 시점**: S1 = AiFeature·AiTokenLog.provider·AiChatProviderId·AiChatConversation(project_id·shared·share_token 제외)·AiChatMessage(feedback/parent/citations 제외). S2 = AiChatMessage에 `feedback`·`parent_message_id` + `AiChatAttachment`. S3 = AiChatConversation에 `project_id`·`shared`·`share_token` + AiChatMessage에 `citations` + `AiChatCitation`·`AiChatProject`·`AiChatProjectKnowledge`.

**`lib/token-logger.ts`** (S1): `LogParams`에 `provider?: string` 추가, insert에 `provider: params.provider ?? null` — 기존 호출처 무수정(옵셔널).

---

## 4. 프로바이더 인터페이스 계약 — `lib/ai-chat/provider.ts` 최종형 (3세션 누적)

**확정 스타일 = S1의 콜백+Promise** (01-architecture·S3 초안의 `AsyncIterable` 표기는 폐기). 확장은 전부 **옵션 필드 추가**로만 — 하위 세션 호출부 무수정 호환.

```ts
import type { AiChatProviderId, AiChatCitation } from '@/types/database'

export type ProviderId = AiChatProviderId

// ── 턴 (S1 기본 + S2 attachments) ──
export interface AttachmentInput {                       // S2
  kind: 'image' | 'pdf' | 'document'
  mime: string
  filename: string
  dataBase64: string          // 서버가 Storage download → base64 (document는 원문/추출 텍스트의 base64 — office 계열은 서버 텍스트 추출)
}
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  attachments?: AttachmentInput[]                        // S2 — user 턴에만
}

export interface ChatUsage { promptTokens: number; outputTokens: number; totalTokens: number }

export interface ChatToolsOption { webSearch?: boolean } // S3 — v1은 web_search만

// ── streamChat 파라미터 (필드명 `turns` 고정 — `messages` 표기 폐기) ──
export interface StreamChatParams {
  apiKey: string
  model: string
  system?: string
  turns: ChatTurn[]                                      // 마지막 원소 = 이번 사용자 발화
  maxOutputTokens?: number                               // 미지정 시 capabilities.defaultMaxOutputTokens
  signal: AbortSignal                                    // 필수 — Stop/클라 이탈 전파
  tools?: ChatToolsOption                                // S3
  onDelta: (text: string) => void
  onThinking?: (text: string) => void                    // S1 — Claude summarized thinking
  onCitation?: (c: AiChatCitation) => void               // S3 — web_search 출처(중복 url dedupe는 호출측)
  onToolStatus?: (s: 'searching' | 'done') => void       // S3 — "웹 검색 중…" 인디케이터
}

export interface StreamChatResult {
  text: string                                           // 누적 전체 응답
  thinking: string | null
  usage: ChatUsage                                       // 미보고 시 0
  stopped: boolean                                       // signal abort로 중단
  citations?: AiChatCitation[]                           // S3 — 수집분(저장용)
}

// ── capabilities (S1부터 4필드 전부 선언 — S2/S3가 vision/tools를 소비) ──
export interface ProviderCapabilities {
  vision: boolean
  tools: boolean
  thinking: boolean
  defaultMaxOutputTokens: number
}

export interface ChatProvider {
  id: ProviderId
  label: string                                          // 'Gemini' | 'Claude' | 'OpenAI'
  capabilities: ProviderCapabilities
  streamChat(params: StreamChatParams): Promise<StreamChatResult>
  listModels(apiKey: string): Promise<string[]>          // {id,label}[] 표기 폐기 — string[] 고정
}
```

**capability 확정값 (v1)**

| provider | vision | tools | thinking | defaultMaxOutputTokens | 기본 모델 |
|---|---|---|---|---|---|
| gemini | true | true (`google_search`) | false | 8192 | META `gemini_model` → 폴백 `gemini-2.0-flash` |
| claude | true | true (`web_search_20260209`, max_uses 5, pause_turn ≤3회) | true (adaptive/summarized) | 32000 | `claude-opus-4-8` |
| openai | true | **false** (chat.completions — Responses API 전환은 범위 외) | false | 16384 | 없음 — 어드민 선택 필수(미설정 시 available 제외) |

- S1 시점: vision·tools는 선언만(true/false 고정값), 소비는 S2(vision)·S3(tools).
- 멀티모달 매핑 순수함수(`toClaudeContent`/`toGeminiParts`/`toOpenAiContent`/`attachmentFallbackText`)는 `lib/ai-chat/attachments.ts`(S2), 턴 매핑(`toGeminiContents`/`toClaudeMessages`/`toOpenAiMessages`)은 각 어댑터에서 export(S1) — 전부 단위테스트 대상.

---

## 5. SSE 프로토콜 계약 — `POST /api/admin/ai-chat/stream`

### 5-1. 요청 (S2에서 상위 호환 확장 — S1 형식은 `mode` 생략형)

```ts
type StreamBody = {
  conversationId: string                    // uuid
  mode?: 'send' | 'regenerate' | 'edit'     // 생략 = 'send' (S1은 send만)
  content?: string                          // send·edit: trim 후 1자 이상(≤32000자) 또는 attachmentIds ≥1
  attachmentIds?: string[]                  // S2 — 본인 소유·해당 대화·message_id null만 유효
  editedMessageId?: string                  // S2 edit 필수 — 활성 스레드 내 본인 user 메시지
  tools?: { webSearch?: boolean }           // S3 — capabilities.tools=false 프로바이더에 지정 시 400
}
```

응답 헤더(고정): `Content-Type: text/event-stream` · `Cache-Control: no-cache` · `Connection: keep-alive`.

### 5-2. 이벤트 봉투 (한 줄 = `data: <JSON>\n\n` — 전 세션 통일)

| 이벤트 | 형식 | 세션 |
|---|---|---|
| 텍스트 델타 | `data: {"delta":"..."}` | S1 |
| thinking 델타 | `data: {"thinking":"..."}` | S1 방출(Claude), S2 UI 소비 |
| 출처(툴) | `data: {"citation":{"url":"...","title":"...","snippet":"..."}}` | S3 |
| 툴 상태 | `data: {"toolStatus":"searching"}` / `data: {"toolStatus":"done"}` | S3 |
| 완료 | `data: {"done":true,"messageId":"<uuid>"}` | S1 |
| 에러 | `data: {"done":true,"error":"메시지"}` — **done과 결합 고정** (단독 `{"error"}` 이벤트 없음) | S1 |

- 서버 규칙: 정상/중단 공통으로 assistant row insert(또는 regenerate 시 update 치환) 후 `done` 방출. 프로바이더 예외 시 `error` 채운 row insert 후 `done+error`. 클라 이탈 시 이벤트 전송은 불가해도 부분 저장은 수행.
- 히스토리: 메시지 전체 로드(asc) → `buildActiveThread()`(S2 이후; S1은 원본 순서) → **최근 40턴 상한** → `error is null`만 → ChatTurn[].
- system 합성 순서(S3 확정): `[1] conversation.system_prompt → [2] project.instructions → [3] <project_knowledge> top-k 블록`.

### 5-3. 클라 파서 규약 (`lib/ai-chat/sse.ts` `createSseParser()` — 서버 프로바이더·클라 훅 공용 SSOT)

- `\n` 분리 → 마지막 미완 라인은 버퍼 이월 → `data: ` 접두 라인만 `JSON.parse`, malformed는 skip. `flush()`로 잔여 처리.
- 클라 훅 `use-sse-chat.ts` — 메서드명 **`send`** 고정(`start` 표기 폐기):

```ts
export interface SseChatEvents {
  onDelta(text: string): void
  onThinking(text: string): void
  onCitation?(c: AiChatCitation): void                   // S3
  onToolStatus?(s: 'searching' | 'done'): void           // S3
  onDone(payload: { messageId: string }): void
  onError(message: string): void
}
export function useSseChat(): {
  send(body: StreamBody, ev: SseChatEvents): Promise<void>
  stop(): void                                           // AbortController.abort()
  streaming: boolean
}
```
분기 규칙: 이벤트 객체에 `delta`→onDelta, `thinking`→onThinking, `citation`→onCitation, `toolStatus`→onToolStatus, `done`이 true이고 `error` 존재→onError, 아니면→onDone.

---

## 6. API / 서버액션 인덱스 (전 엔드포인트 · 시그니처 · 세션 태그)

**공통 컨벤션(고정)**: 페이지=`requireAdmin()`, API=`requireAdminApi()`. 서버액션 반환은 **`{ ok: boolean; …; error?: string }` 봉투로 통일** (`Promise<void>`·bare 배열 반환 표기 폐기). write는 소유 검증 후 `createAdminClient()`.

### 6-1. Route Handlers

| 메서드·경로 | 요청 | 응답 | 세션 |
|---|---|---|---|
| `POST /api/admin/ai-chat/stream` | `StreamBody` (§5-1) | SSE (§5-2) | S1, S2·S3 확장 |
| `POST /api/admin/ai-chat/upload` | multipart `{file, conversationId}` | `{attachment:{id,filename,mime,sizeBytes,kind,signedUrl}}` / 400·401·403·404·500 | S2 |
| `DELETE /api/admin/ai-chat/upload` | JSON `{attachmentId}` (message_id null만 삭제 가능) | `{ok:true}` | S2 |
| `POST /api/admin/ai-chat/knowledge-upload` | multipart (text/plain·markdown·csv ≤1MB + docx/xlsx/pptx·pdf ≤10MB — S2 `extractDocumentText`(officeparser) 재사용) → `addKnowledgeText` 위임 | `{ok, chunks?, embedded?, error?}` | S3 |
| `GET /api/admin/ai-chat/export?c=<id>` | — | `text/markdown` attachment 다운로드 | S3 |

### 6-2. 서버 액션 — `app/admin/ai-chat/actions.ts`

| 액션 | 시그니처(요약) | 세션 |
|---|---|---|
| createConversation | `({provider: AiChatProviderId; model: string}) → {ok, id?, error?}` | S1 |
| listConversations | `({cursor?, limit? /*기본30 최대50*/}?) → {ok, items?: AiChatConversation[], nextCursor?, error?}` — `pinned desc, updated_at desc` | S1 |
| getMessages | `({conversationId, before?, limit? /*기본50*/, choices? /*S3 분기 선택*/}) → {ok, items?, nextCursor?, error?}` — **items = (AiChatMessage & {attachments: AttachmentView[]})[]**, S2 이후 활성 스레드 기준 서버 재구성 + 첨부 signedUrl 신규 발급(TTL 1h). S3: `choices?: Record<string,string>` 입력 + user 메시지에 `branch?: {rootId,index,count}` 메타(분기 네비게이션 — 세션3 §5-5) | S1, S2·S3 확장 |
| renameConversation | `(id, title /*1~100자*/) → {ok, error?}` | S1 |
| togglePin | `(id) → {ok, pinned?, error?}` | S1 |
| updateConversationModel | `(id, provider, model) → {ok, error?}` | S1 |
| softDeleteConversation / restoreConversation | `(id) → {ok, error?}` | S1 |
| autoTitle | `(conversationId) → {ok, title?, error?}` — 실패 시 30자 절삭 폴백, throw 금지 | S1 |
| searchConversations | `(q) → {ok, items?: {id,title,pinned,updated_at,snippet}[], error?}` — sanitize 후 제목/본문 2쿼리 병합(.or() 금지), 상위 20 | S2 |
| updateSystemPrompt | `(conversationId, systemPrompt: string \| null /*≤4000자*/) → {ok, error?}` | S2 |
| setMessageFeedback | `(messageId, feedback: 1 \| -1 \| null) → {ok, error?}` | S2 |
| createProject | `(name, instructions?) → {ok, id?, error?}` | S3 |
| listProjects | `() → {ok, items?: AiChatProject[], error?}` | S3 |
| updateProject | `(id, patch: {name?, instructions?}) → {ok, error?}` — update 시 `updated_at = now()` 명시 갱신(touch 트리거 없음) | S3 |
| softDeleteProject | `(id) → {ok, error?}` | S3 |
| setConversationProject | `(conversationId, projectId: string \| null) → {ok, error?}` | S3 |
| addKnowledgeText | `(projectId, text, source) → {ok, chunks?, embedded?, error?}` | S3 |
| listKnowledge | `(projectId) → {ok, items?: {source,chunks,createdAt}[], error?}` | S3 |
| deleteKnowledgeSource | `(projectId, source) → {ok, error?}` | S3 |
| toggleShare | `(conversationId, on: boolean) → {ok, token?, error?}` — 153 공유 옵트인 | S3 |

### 6-3. 설정 액션 — `app/admin/settings/actions.ts` (S1)

`saveClaudeKey(formData)` / `saveClaudeModel(model)` / `getClaudeModels()` (`GET https://api.anthropic.com/v1/models`, 헤더 `x-api-key` + `anthropic-version: 2023-06-01`) · `saveOpenAiKey(formData)` / `saveOpenAiModel(model)` / `getOpenAiModels()` (`GET https://api.openai.com/v1/models`, Bearer, gpt/o 계열 필터) · `saveAiChatDefaultProvider(provider: AiChatProviderId | '')` (META `ai_chat_default_provider` — 빈 값이면 키 제거, 폴백=첫 available) — 전부 `{ok, …, error?}`, 기존 `getMetaValue`/`setMetaValue` 재사용.

---

## 7. META 키 인덱스 (`org_content` `key='META'` JSONB — 키는 서버 전용, 클라 전송 금지)

| META 키 | 용도 | 도입 |
|---|---|---|
| `gemini_api_key` / `gemini_model` | Gemini 키·모델 (기존 체계 재사용) | 기존 |
| `claude_api_key` / `claude_model` | Claude 키·모델 — **표준명 `claude_api_key`** (상위 기획의 `anthropic_api_key` 표기 폐기) | S1 |
| `openai_api_key` / `openai_model` | OpenAI 키·모델 (모델 미설정 시 available 제외) | S1 |
| `ai_chat_default_provider` | 신규 대화 기본 프로바이더(`AiChatProviderId`). 미설정/미가용 시 첫 available 폴백 | S1 (registry `getDefaultProvider(meta)` + 설정 UI `saveAiChatDefaultProvider` — §9 감사 D-11 참조) |
| (기존) `ai_token_alert_threshold` / `ai_token_alert_sent_month` | 토큰 알림 가드 — 무변경 재사용 | 기존 |

registry `META_KEYS` 상수(S1)가 이 표의 SSOT 구현체다. META 조회는 호출측이 `createAdminClient()`로 읽어 순수 함수에 전달(token-logger.ts:39-41 패턴).

---

## 8. 의존성 인덱스 (세션별 신규 npm — `pnpm --filter web add`)

| 세션 | 패키지 | 용도 |
|---|---|---|
| S1 | `react-markdown` · `remark-gfm` · `rehype-highlight` · `highlight.js` | 마크다운+GFM+코드 하이라이트 (테마 CSS import 금지 — `.hljs-*` 토큰 매핑) |
| S1 | `@anthropic-ai/sdk` · `openai` | Claude/OpenAI 어댑터 (Gemini는 REST 직호출 — 무의존) |
| S2 | `officeparser` | docx/xlsx/pptx 첨부 텍스트 추출(+S3 지식 업로드의 office·pdf 추출도 재사용). 업로드=FormData·매직바이트 자체 구현 |
| S3 | `katex` · `remark-math` · `rehype-katex` | LaTeX 렌더 (`trust:false`). mermaid 파서 추가 금지(코드 표시만) — pdf/office 텍스트 추출은 S2 `officeparser` 재사용 |

DOMPurify는 **도입하지 않는다** — MarkdownMessage는 `skipHtml`(raw HTML 비활성)로 XSS 면적을 제거(§9 D-10).

---

## 9. 세션 문서와 이 계약의 차이 (구현 시 이 계약 우선 — 정정 대상 요약)

| ID | 어긋난 지점 | 계약 확정값 |
|---|---|---|
| D-1 | S2·S3가 참조하는 RLS/트리거명 `aic_owner_admin`·`aim_via_conv`·`trg_aic_touch` | §1-3 실명(`aicc_admin_owner`·`aicm_admin_owner`·`trg_aicc_touch`) |
| D-2 | S1 capabilities `{thinking, defaultMaxOutputTokens}` vs S2·S3 전제 `{vision,tools,thinking}` | §4 `ProviderCapabilities` 4필드 — S1부터 전부 선언 |
| D-3 | 01-architecture·S3의 `streamChat(): AsyncIterable` + `messages` 필드 | S1 콜백+Promise + `turns` 고정, S3는 onCitation/onToolStatus 콜백 추가 |
| D-4 | S2 §4-4 단독 `data:{"error":"..."}` 이벤트 | `data:{"done":true,"error":"..."}` 결합 고정 (S1·런북) |
| D-5 | S2 §5-2 `getMessages(conversationId, cursor)` 신시그니처 | S1 객체 파라미터 + `{ok, items, nextCursor}` 봉투 유지, items에 feedback·attachments 누적 |
| D-6 | S2·S3 일부 액션 `Promise<void>`/bare 배열 반환 | `{ok, …}` 봉투 통일 |
| D-7 | S2 §1-4 "thinking 비영속(컬럼 신설 금지)" vs S1 150의 thinking 컬럼+저장 | thinking은 150부터 영속 — S2 문구가 오류 |
| D-8 | S2 §6-4 `start(body)` vs S1 `send(body, ev)` | `send` 고정 |
| D-9 | 01-architecture `anthropic_api_key` | `claude_api_key` (S1 registry) |
| D-10 | S3 §0-1 "MarkdownMessage에 DOMPurify" | DOMPurify 미도입 — `skipHtml` (S1) |
| D-11 | `ai_chat_default_provider`(상위 기획 F9)가 3세션 어디에도 미배정 | S1 registry에 `getDefaultProvider(meta)` 추가로 수용 (createConversation 기본값 소스) |
| D-12 | 01-architecture `listModels → {id,label}[]` | `string[]` (S1) |

(전체 감사 결과는 CEO 보고 텍스트 참조 — 본 절은 구현 루프가 즉시 참조할 확정값만 수록.)
