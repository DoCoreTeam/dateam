# 세션2 Integration Spec — 세션1 소유 파일 배선 (머지 시 적용)

> 병행 실행이라 세션1 소유 파일을 이 브랜치에서 **직접 수정하지 않는다**(미완성 작업 손상 방지).
> 세션1 머지 후, 아래 편집을 **04 계약(SSOT) 시그니처 그대로** 적용한다. 설계서와 어긋나면 04 우선.
> net-new 파일(이 브랜치 실제 생성): migration 151 · lib/ai-chat/{attachments,thread,search}.ts(+테스트) · api/admin/ai-chat/upload/route.ts · admin/ai-chat/SystemPromptModal.tsx — 아래 배선은 이들을 import·호출한다.

---

## 1. `apps/web/lib/ai-chat/provider.ts` (세션1 생성 → 세션2 옵션 필드 추가)

계약 §4 최종형에 이미 포함. 세션1이 §4 전체를 그대로 만들면 **수정 불필요**. 만약 세션1이 attachments 옵션을 누락했다면 추가:

```ts
export interface AttachmentInput {                 // S2
  kind: 'image' | 'pdf' | 'document'
  mime: string
  filename: string
  dataBase64: string   // Storage download→base64 (document는 원문/추출 텍스트의 base64)
}
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  attachments?: AttachmentInput[]                  // S2 — user 턴에만. 기존 호출부 무수정 호환
}
```
> 확인만: `StreamChatParams`/`ProviderCapabilities`(vision 포함 4필드)/콜백+Promise 스타일은 세션1 소관. 변경 없음.

## 2. `apps/web/types/database.ts` (세션1 생성 → 세션2 필드/타입 추가)

- `AiChatMessage`(세션1 생성)에 **2필드 추가**(계약 §3):
  ```ts
  feedback: -1 | 1 | null              // S2/151
  parent_message_id: string | null     // S2/151 — 편집분기
  ```
  (citations는 S3. S2는 넣지 않음.)
- `AiChatAttachment` 인터페이스 **신규 추가**(계약 §3 그대로): id·message_id(nullable)·conversation_id·user_id·storage_path·filename·mime·size_bytes·kind('image'|'pdf'|'document'|'other')·created_at.
- `Database` 제네릭 타입에 `ai_attachments` 테이블 Row/Insert/Update 등록(세션1의 ai_conversations/ai_messages 등록 패턴과 동일 위치).

## 3. `apps/web/lib/ai-chat/providers/{claude,gemini,openai}.ts` (세션1 생성 → 첨부 매핑 배선)

각 어댑터가 turn을 조립하는 지점에서, `turn.attachments?.length`면 매핑 순수함수를 호출(계약 §4-2, 함수는 net-new `@/lib/ai-chat/attachments.ts` 제공):
- `claude.ts`: `messages` content = `turn.attachments?.length ? toClaudeContent(turn) : turn.content`
- `gemini.ts`: `contents[].parts = toGeminiParts(turn)` (첨부 없으면 `[{text: turn.content}]`)
- `openai.ts`: `messages[].content = turn.attachments?.length ? toOpenAiContent(turn) : turn.content`
> 매핑 로직은 어댑터에 복붙 금지 — attachments.ts 함수 import만.

## 4. `apps/web/app/api/admin/ai-chat/stream/route.ts` (세션1 생성 → 세션2 확장)

계약 §5-1 `StreamBody` 상위호환(`mode?`·`attachmentIds?`·`editedMessageId?` 추가). 설계 §4-4 처리:
1. `requireAdminApi()` + 대화 소유 검증(admin client). **[공통2단계]** `conversation.system_prompt` 있으면 `streamChat({ system })` 주입 — 세션1 누락 시 반드시 연결(§5-5·§4-4).
2. 히스토리 = 전체 메시지 asc 로드 → **`buildActiveThread()`**(net-new `@/lib/ai-chat/thread.ts`) → 최근 40턴 → `error is null` → ChatTurn[]. user 턴 첨부는 `ai_attachments` 일괄조회 → Storage `download()` → base64로 `attachments` 채움(document는 `extractDocumentText` 텍스트의 base64).
3. **요청 총량 가드**: 첨부 원본 합 > `MAX_REQUEST_ATTACHMENT_BYTES`(20MB) → 오래된 턴부터 `attachmentFallbackText`로 대체 감축.
4. **vision 3중방어**(설계 §4-3): 신규 attachmentIds인데 현재 provider `capabilities.vision===false` → 400 `'현재 프로바이더는 첨부를 지원하지 않습니다'`. 과거 첨부 턴을 vision 미지원으로 이어가면 해당 턴 content 앞에 `attachmentFallbackText()` 붙이고 attachments 생략.
5. SSE 봉투 = 계약 §5-2 그대로(`delta`/`thinking`/`done`/`done+error`). 단독 error 이벤트 금지.
6. **mode별**:
   - `send`: user insert → `ai_attachments.message_id`를 새 user id로 update(`where id in attachmentIds and user_id=me and conversation_id=conv and message_id is null`; affected≠length → 400 롤백) → 스트림 → assistant insert.
   - `regenerate`(설계 §5-1): 활성스레드 마지막이 assistant 아니면 400. 히스토리=마지막 assistant 제외. 현재 provider/model 재스트림. 완료 시 기존 assistant row **update 치환**(content·provider·model·prompt_tokens·output_tokens·error=null·**feedback=null**; created_at 유지). 삭제+재삽입 금지.
   - `edit`(설계 §5-2): `editedMessageId`가 활성스레드 내 본인 user인지 검증(아니면 400). user insert `{content, parent_message_id: editedMessageId}` + 첨부 연결(send 규칙) → insert 후 활성스레드 → 스트림 → assistant insert(parent null).
7. 완료 시 메시지 저장 + `logTokenUsage({provider})`(세션1 token-logger).

## 5. `apps/web/app/admin/ai-chat/actions.ts` (세션1 생성 → 세션2 액션 3개 + getMessages 확장)

전부 `{ ok, …, error?}` 봉투(계약 §6). `requireAdmin` 게이트 + admin client 소유검증.

- **searchConversations(q)** (계약 §6-2 / 설계 §5-3): `sanitizeSearchQuery`(net-new `@/lib/ai-chat/search.ts`) null이면 `{ok:true, items:[]}`. **`.or()` 미사용** — 2쿼리 분리: Q1 `ai_conversations` title ilike(limit20), Q2 `ai_messages` 본인 대화스코프 content ilike → conversation_id distinct+첫 매치(limit20). 병합·중복제거 → `pinned desc, updated_at desc` 상위20. snippet=본문매치 ±40자(제목만이면 null). 반환 items: `{id,title,pinned,updated_at,snippet}`.
- **updateSystemPrompt(conversationId, systemPrompt: string|null)** (§6-2 / 설계 §5-5): 소유검증 → trim, 4000자 초과 시 `{ok:false, error}`, 빈문자열 → null 저장. throw 금지.
- **setMessageFeedback(messageId, feedback: 1|-1|null)** (§6-2 / 설계 §5-7): admin client로 message→conversation 소유검증(user_id=me) → `ai_messages.feedback` update.
- **getMessages 확장**(계약 §6-2 / 설계 §5-2 D-5): 세션1 객체 파라미터 `{conversationId, before?, limit?}` + `{ok, items, nextCursor}` 봉투 **유지**. 서버가 전체 로드 → `buildActiveThread` 적용 → **활성 스레드** 기준 커서 페이지네이션. items 각 원소에 `attachments: {id,filename,mime,kind,sizeBytes,signedUrl}[]` 누적(`ai_attachments` message_id in 조회 → `createSignedUrl` TTL 1h 신규발급). items 타입에 thinking·feedback·parent_message_id 포함.

## 6. `apps/web/app/admin/ai-chat/Composer.tsx` (세션1 생성 → 첨부 UI)

설계 §6-1. props 추가: `visionSupported: boolean`, `onSend(content, attachmentIds)`. 상태 `pendingAttachments: PendingAttachment[]`, `isDragOver`.
- 입력 3경로: ① `<input type=file multiple accept={ACCEPT}>`(ACCEPT=`ATTACHMENT_RULES` mimes 평탄화 import — 이중정의 금지) ② 래퍼 drag ③ `onPaste` clipboardData.files.
- 파일별 클라 사전검증(`ATTACHMENT_RULES`) → 병렬 POST `/api/admin/ai-chat/upload`. 실패 status='error' 칩.
- 칩 영역: 이미지 48px 썸네일, pdf/document `<FileText/>`+파일명(160px 말줄임)+크기. 칩 X → DELETE API.
- 전송조건 `content.trim() || readyAttachments.length>0`, uploading 있으면 disabled.
- `visionSupported===false`: 버튼 disabled+툴팁, drop/paste 무시+토스트(§4-3). **현재 provider 실시간 반영**.
- 신규 클래스는 `globals.css`에 `ai-chat-*` 프리픽스(토큰만). 인라인 style 금지.

## 7. `apps/web/app/admin/ai-chat/MessageList.tsx`(MessageBubble) (세션1 생성 → 액션 확장)

설계 §6-2 / §5-6. MessageBubbleProps: message(+thinking·feedback·attachments)·isLastAssistant·isStreaming·thinkingText·onRegenerate·onEditSubmit·onFeedback. 내부상태 isEditing·editDraft·thinkingOpen.
- user 버블: 첨부 표시(이미지 ≤240px 미리보기, 파일 칩) + hover 복사·`✎편집`(인라인 편집 §5-2).
- assistant 버블: (위→아래) **thinking 접이식**(`▸ 추론 과정` 토글; 스트리밍 중 자동펼침+AXDotLoader, 완료 자동접힘; 본문 MarkdownMessage 재사용, `--text-muted`, `border-left`; 스트리밍 중 `thinkingText`·완료/복원 후 `message.thinking`; thinking null 또는 capability.thinking===false면 미렌더) → MarkdownMessage 본문 → hover: 복사·`↻재생성`(isLastAssistant&&!isStreaming)·👍·👎(선택 `--accent` 채움, 재클릭 해제).
- 리스트 갱신은 상위 AiChatClient가 `buildActiveThread`(동일 SSOT import) 재계산.

## 8. `apps/web/app/admin/ai-chat/ConversationSidebar.tsx` (세션1 별도파일 → 검색+pin섹션)

설계 §5-3·§5-4 / §6-3. 추가상태 searchQuery·searchResults(null=검색아님)·isSearching.
- 상단 검색 input(`input-field`, `<Search size=14/>`, 300ms 디바운스, 2자미만 목록복귀, ESC 클리어). 결과 항목 제목+snippet(굵게 강조), 클릭 `?c=<id>`.
- 목록: 비검색 모드 = **고정됨/최근 2섹션**(pinned에 `<Pin size=12/>`+헤더; 정렬·togglePin은 세션1 산출 확인만). 검색 모드 = 결과 리스트.
- 3상태(로딩 AXDotLoader / 빈결과 / 에러) 유지.

## 9. `apps/web/app/admin/ai-chat/AiChatClient.tsx` (세션1 생성 → 배선)

설계 §6-4. `page.tsx`(서버)가 registry provider별 `capabilities` 로드 → client 전달. 현재 대화 provider의 `vision`→Composer, `thinking`→MessageBubble 배선. `use-sse-chat`는 세션1 산출 그대로(`send(body, ev)`·`onThinking`); body에 `mode`/`attachmentIds`/`editedMessageId` 사용만 추가. 편집·재생성 후 `buildActiveThread`로 활성스레드 재계산.

## 10. `package.json` (루트 + apps/web)

- 의존성: `pnpm --filter web add officeparser` (docx/xlsx/pptx 텍스트 추출; S3 지식 업로드 재사용).
- `apps/web/package.json` `test` 스크립트 파일 목록에 **3파일 등재**(자동포함 안 됨):
  `lib/ai-chat/attachments.test.ts` · `lib/ai-chat/thread.test.ts` · `lib/ai-chat/search.test.ts`.

## 11. 버전 (머지 재조정)
병행 3세션이 각자 PATCH를 올리면 충돌. **머지 순서 1→2→3에서 최종 버전 순차 배정**(세션2 = 세션1 다음 PATCH). 커밋 시 `v{확정}: … claude` 형식(CLAUDE.md), 제목 끝 `claude` 소문자.
