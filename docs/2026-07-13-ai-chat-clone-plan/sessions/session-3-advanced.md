# 세션 3 — 고급 (Artifacts · Projects · 툴 · 공유/내보내기 · 분기 네비게이션) 상세설계 (구현 배치 3)

> 루프 실행 단위. 이 문서만으로 신규 세션이 완결 구현 가능하도록 자기완결적으로 작성.
> 상위 기획: `docs/2026-07-13-ai-chat-clone-plan/{00-requirements,01-architecture,03-feature-manifest}.md`
> **공용 구현 계약(SSOT)**: `sessions/04-implementation-contract.md` — 명명·시그니처가 어긋나면 04가 우선.
> 전제: dateam Next.js 14.2.29 App Router + Supabase. 데이터=Supabase Postgres(`scripts/migrate.sh` 순번 마이그레이션), RLS 필수, **어드민 전용**, 고급 모델 기본.

## 0. 개요 / 선행조건 / 범위

### 0-1. 선행조건 (세션 1·2 완료·머지 필수)
- 테이블 `ai_conversations` / `ai_messages` / `ai_attachments` + RLS(`aicc_admin_owner`·`aicm_admin_owner`·`aia_owner_admin`) 존재. 마이그레이션 **150·151 적용 완료** → 이 세션은 **152·153** 사용.
- `lib/ai-chat/` 3 프로바이더 추상화(`provider.ts`/`providers/{gemini,claude,openai}.ts`/`registry.ts`) + `streamChat`(콜백+Promise) SSE + `/admin/ai-chat` UI 동작. `capabilities={vision,tools,thinking,defaultMaxOutputTokens}` 4필드 존재(04 §4).
- 마크다운 렌더러 `MarkdownMessage.tsx`(react-markdown+remark-gfm+`skipHtml`(raw HTML 비활성 — DOMPurify 미도입, 04 §8)+코드블록 복사) 존재 — 이 세션에서 확장.
- **pgvector 사용 중**(기존 인프라 재사용): `042_memo_discovery.sql`이 `CREATE EXTENSION IF NOT EXISTS vector` + `daily_logs.embedding vector(768)` + ivfflat `vector_cosine_ops`(lists=100) 도입. 임베딩 라이브러리 `apps/web/lib/gemini-embedding.ts`(`gemini-embedding-001`, `EMBED_DIM=768`, `toVectorLiteral`) → **프로젝트 지식 RAG에 재사용**.
- top-k RPC 패턴 레퍼런스: `147_match_daily_logs_exclude_deleted.sql`의 `match_daily_logs(query_embedding vector(768), ...)`.
- 토큰 로깅: `ai_token_logs`(user_id, feature, model, prompt_tokens, output_tokens, total_tokens, success, created_at, **provider**(150에서 추가)) + `lib/token-logger.ts`. 기존 집계 화면 `/admin/ai-usage` 존재 → **비용 대시보드는 이 화면 확장**(재사용·단일구현 정책).

### 0-2. 목표 / 범위 — "100% 클론" 마감 (전 항목 확정 스펙 — 배치 3)
| 기능 | 내용 |
|------|------|
| **Artifacts** | 응답 내 코드/HTML/마크다운 문서 → 우측 격리 프리뷰 패널(HTML=sandbox iframe), 버전·복사·다운로드 |
| **Projects** | 프로젝트 CRUD + 지식(파일/텍스트/지시) 업로드→임베딩→대화 시 top-k 컨텍스트 주입, 대화-프로젝트 연결 |
| **툴** | provider server tool(web_search) capability 게이팅 + 출처(citation) 카드 렌더 |
| **분기 네비게이션** | 편집분기 `‹ k/n ›` 전환·과거 분기 열람(§5-5 — 데이터 모델은 151 `parent_message_id`로 완결) |
| **공유/내보내기** | 대화→markdown export 다운로드 + admin 경계 내 공유 옵트인 토큰(153 — 확정) |
| **부가** | LaTeX(KaTeX) 수식 렌더, 토큰/비용 대시보드(`/admin/ai-usage` 확장) |

**제외(확정 설계 결정 — 유예 아님)**: 비admin 공개 인터넷 공유(§5-2), OpenAI Responses API 전환, 프로젝트 지식의 URL 크롤링(SSRF 원천 차단 — 업로드/붙여넣기만 허용).

### 0-3. 핵심 설계 결정 (요약 — 상세는 각 절)
1. **Artifacts 저장 = `ai_messages` 파생(derived)** — 별도 `ai_artifacts` 테이블 없음(§2-1).
2. **공유 = admin 인증 경계 내 옵트인 토큰**(마이그레이션 153 — 확정) — 공개 인터넷 공유는 채택하지 않음(§5-2).
3. **임베딩 = `lib/gemini-embedding.ts` 비파괴 확장**(taskType/feature 옵션 파라미터 추가, 기존 호출처 무변경)(§3-2).
4. **비용 대시보드 = 기존 `/admin/ai-usage` 확장**(신규 화면 금지 — SSOT)(§5-4).
5. **분기 네비게이션 = 열람·전환 확정, 전송·재생성·편집은 활성(최신) 스레드에서만**(§5-5 — 시간순 리플레이 SSOT 유지, 트리 포인터 모델 미도입).

---

## 1. DB 마이그레이션 152 — `supabase/migrations/152_ai_chat_projects.sql` (전체 SQL)

```sql
-- =============================================================================
-- 152_ai_chat_projects.sql
-- AI 채팅 세션3: Projects + 프로젝트 지식(pgvector RAG) + 대화-프로젝트 연결
-- RLS: admin+owner default-deny (150 ai_conversations 패턴 동일)
-- pgvector: 042에서 이미 활성화 — 방어적 재선언만 수행
-- =============================================================================

-- 0. pgvector 확장 (042에서 활성화됨 — 멱등 방어)
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. ai_projects — 프로젝트 (owner=admin)
CREATE TABLE ai_projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name         text NOT NULL,
  instructions text,                                   -- 프로젝트 공통 지시(system에 주입)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz                             -- 소프트삭제
);
CREATE INDEX idx_ai_projects_owner
  ON ai_projects (user_id, updated_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE ai_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY aip_owner_admin ON ai_projects FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles
          WHERE id = (SELECT auth.uid()) AND role = 'admin' AND deleted_at IS NULL)
  AND user_id = (SELECT auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles
          WHERE id = (SELECT auth.uid()) AND role = 'admin' AND deleted_at IS NULL)
  AND user_id = (SELECT auth.uid())
);

-- 2. ai_conversations.project_id — 대화-프로젝트 연결
ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES ai_projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ai_conversations_project
  ON ai_conversations (project_id) WHERE project_id IS NOT NULL AND deleted_at IS NULL;

-- 3. ai_project_knowledge — 지식 청크 (pgvector 768 — gemini-embedding-001 정합)
CREATE TABLE ai_project_knowledge (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  content     text NOT NULL,                            -- 청크 본문 (≤2000자 — embedText slice 한도)
  embedding   vector(768),                              -- 임베딩 실패 시 NULL 허용(저장은 막지 않음)
  source      text,                                     -- 원본 식별: 파일명 또는 'manual'
  chunk_index int NOT NULL DEFAULT 0,                   -- 원본 내 청크 순번(복원·삭제 단위)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_project_knowledge_project
  ON ai_project_knowledge (project_id, source, chunk_index);

-- pgvector 유사도 (cosine) — 042 daily_logs와 동일 파라미터
CREATE INDEX idx_ai_project_knowledge_embedding
  ON ai_project_knowledge USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE ai_project_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY aipk_via_project ON ai_project_knowledge FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles
          WHERE id = (SELECT auth.uid()) AND role = 'admin' AND deleted_at IS NULL)
  AND EXISTS (SELECT 1 FROM ai_projects p
              WHERE p.id = project_id
                AND p.user_id = (SELECT auth.uid())
                AND p.deleted_at IS NULL)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles
          WHERE id = (SELECT auth.uid()) AND role = 'admin' AND deleted_at IS NULL)
  AND EXISTS (SELECT 1 FROM ai_projects p
              WHERE p.id = project_id
                AND p.user_id = (SELECT auth.uid())
                AND p.deleted_at IS NULL)
);

-- 4. top-k 검색 RPC — match_daily_logs(147) 패턴 동일. requester 소유 검증 내장(이중 방어).
CREATE OR REPLACE FUNCTION match_ai_project_knowledge(
  p_project_id    uuid,
  query_embedding vector(768),
  requester_id    uuid,
  match_count     int,
  min_sim         float
)
RETURNS TABLE (id uuid, content text, source text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT k.id, k.content, k.source, 1 - (k.embedding <=> query_embedding)
  FROM ai_project_knowledge k
  JOIN ai_projects p ON p.id = k.project_id
  WHERE k.project_id = p_project_id
    AND k.embedding IS NOT NULL
    AND p.deleted_at IS NULL
    AND p.user_id = requester_id                        -- owner만 (admin 간 격리 유지)
    AND EXISTS (SELECT 1 FROM profiles pr
                WHERE pr.id = requester_id AND pr.role = 'admin' AND pr.deleted_at IS NULL)
    AND 1 - (k.embedding <=> query_embedding) > min_sim
  ORDER BY k.embedding <=> query_embedding ASC
  LIMIT LEAST(match_count, 20);
$$;

-- 5. 툴 출처 영속화 — web_search citation 복원 재표시용 (§4-3 결정)
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS citations jsonb;  -- [{url,title,snippet?}]
```

**설계 근거**
- RLS는 150의 `aicc_admin_owner`/`aicm_admin_owner` 패턴 그대로: admin 역할 + owner 스코프, default-deny. 서버는 `createAdminClient()`(service_role)로 write하되 서버액션에서 소유 검증을 선행 — RLS는 이중 방어.
- RPC는 admin 클라이언트로 호출되므로(RLS 우회) 함수 본문에 `requester_id` 소유 검증을 내장(147과 동일 철학).
- ivfflat lists=100: 기존 042와 동일값. 지식 행 수가 적은 초기에는 seq scan이 선택돼도 무방(플래너 판단) — 별도 튜닝 불요.
- `chunk_index`+`source`: 원본 파일 단위 일괄 삭제(`DELETE WHERE project_id=? AND source=?`)와 지식 목록 UI 그룹핑에 사용.

### 1-1. 마이그레이션 153 — admin 경계 내 공유 옵트인 (확정)
```sql
-- 153_ai_chat_share.sql — admin 경계 내 공유 옵트인 (확정)
ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_token text UNIQUE;     -- gen_random_uuid()::text, 서버에서 발급
CREATE INDEX IF NOT EXISTS idx_ai_conversations_share_token
  ON ai_conversations (share_token) WHERE shared = true AND deleted_at IS NULL;
-- RLS 변경 없음: owner 기본격리 유지. 공유 열람은 서버(service_role)가
-- shared=true + token 일치 검증 후 read-only로 제공(§5-2). 정책 완화 금지.
```

---

## 2. Artifacts

### 2-1. 저장 설계 결정 — `ai_messages` 파생 (테이블 미신설)

| 대안 | 판단 |
|------|------|
| A. `ai_artifacts` 테이블 신설 | 메시지 content와 이중 저장 → 동기화 오염 위험(재생성·편집분기 시 정합 깨짐). 마이그레이션·RLS 추가 비용 |
| **B. 렌더 시 `ai_messages.content`에서 파싱(파생)** ✅ | **SSOT=메시지 본문**. 세션2 재생성/편집분기와 자동 정합. 파싱 비용은 assistant 메시지당 정규식 1패스로 무시 가능. 대화 밖 재사용(교차 대화 artifact)은 요구사항에 없음 |

**결정: B.** artifact는 저장 개념이 아니라 **뷰 개념** — 마이그레이션 없음. 버전 이력도 대화 내 메시지 순서에서 파생.

### 2-2. 파서 — `apps/web/lib/ai-chat/artifacts.ts` (순수 함수, 단위테스트 대상)

```ts
export type ArtifactType = 'html' | 'code' | 'markdown' | 'svg' | 'mermaid'

export interface ArtifactBlock {
  identity: string      // 버전 그룹핑 키: `${type}:${title}` (title=파일명 주석/헤딩/언어 순 추론)
  type: ArtifactType
  language: string      // 코드펜스 언어 태그 원문 ('' 허용)
  title: string         // 다운로드 파일명 유추에도 사용 (sanitize 필수)
  content: string       // 펜스 내부 원문
}

/** assistant 메시지 1건의 마크다운에서 artifact 승격 대상 블록 추출 */
export function extractArtifacts(markdown: string): ArtifactBlock[]

/** 대화 전체(assistant 메시지 시간순)에서 identity별 버전 시퀀스 구성 */
export function buildArtifactVersions(
  messages: { id: string; content: string; createdAt: string }[],
): Map<string, { messageId: string; block: ArtifactBlock }[]>
```

**추출 규칙(결정적 — 휴리스틱 최소화)**
1. 대상 = 닫힌 코드펜스(``` ``` ```)만. 인라인 코드·열린 펜스는 제외.
2. artifact 승격 조건: (a) 언어가 `html`/`svg`/`mermaid` → 무조건, (b) 그 외 언어 → **15줄 이상 또는 800자 이상**, (c) 언어 `markdown`/`md` + 10줄 이상 → 문서 artifact. 미달 펜스는 기존 인라인 코드블록 렌더 유지.
3. `title` 추론 우선순위: 펜스 첫 줄의 파일명 주석(`// file.ts`, `# file.py`, `<!-- file.html -->`) → 직전 헤딩 텍스트 → `언어 + 순번`. `title`은 `[^\w.\-]` 제거 후 사용(다운로드 파일명 sanitize).
4. `identity = type + ':' + title정규화` — 같은 대화에서 동일 identity 재등장 = 새 버전.

### 2-3. UI — 우측 패널

| 파일 | 역할 |
|------|------|
| `app/admin/ai-chat/ArtifactPanel.tsx` | 우측 슬라이드 패널. 탭(미리보기/코드), 버전 셀렉터(`v1..vN`), 복사, 다운로드, 닫기(X, `useEscClose`) |
| `app/admin/ai-chat/ArtifactChip.tsx` | 메시지 내 artifact 자리 표시 칩(제목+타입 아이콘) — 클릭 시 패널 오픈. `MarkdownMessage`가 artifact 승격 펜스를 칩으로 치환 |
| `app/admin/ai-chat/HtmlSandbox.tsx` | HTML/SVG 격리 프리뷰(§2-4) |

- 레이아웃: 데스크탑 = 채팅 패널 우측 40% 분할(기존 `AiChatClient` 그리드 확장), 모바일 = 전면 오버레이. 디자인 토큰·모달 표준(backdrop `rgba(15,23,42,0.5)`, `tape-title`) 준수.
- 상태: `AiChatClient`에 `activeArtifact: {identity, versionIndex} | null`. 스트리밍 중에는 파싱하지 않고 `done` 후 파싱(불완전 펜스 방지).
- 다운로드: `Blob` + `URL.createObjectURL` 클라 다운로드. 확장자 = 언어→확장자 맵(`lib/ai-chat/artifacts.ts`에 `extForLanguage()` 동거).
- 코드 탭: 세션1 코드블록 렌더러(하이라이터) 재사용. mermaid는 v1에서 코드 표시만(렌더 라이브러리 추가는 범위 외 — 명시적 제외).

### 2-4. HTML sandbox iframe 격리 (보안 — DC-SEC 집중 항목)

```tsx
// HtmlSandbox.tsx 핵심
const CSP = `<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
           img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'">`
<iframe
  sandbox="allow-scripts"                 // allow-same-origin 절대 금지
  srcDoc={CSP + html}
  referrerPolicy="no-referrer"
  style={{ width: '100%', height: '100%', border: 'var(--hairline) solid var(--border-color)' }}
/>
```
- `allow-same-origin` 미부여 → iframe은 opaque origin: 부모 쿠키/localStorage/DOM 접근 불가.
- srcDoc 선두 CSP 주입 → `connect-src 'none'` + `default-src 'none'`으로 외부 요청(데이터 유출·SSRF성 fetch) 차단. 인라인 script/style만 허용(프리뷰 목적 최소권한).
- `allow-popups`/`allow-top-navigation` 미부여 → 탈출 불가. 다운로드한 HTML 파일 실행은 사용자 책임 영역(브라우저 로컬).

---

## 3. Projects

### 3-1. 서버액션 — `app/admin/ai-chat/actions.ts` 확장 (모두 admin 서버 인가 + 소유 검증)

```ts
// 전 액션 { ok, …, error? } 봉투 통일(04 §6 공통 컨벤션 — Promise<void>/bare 반환 금지)
// Projects CRUD
export async function createProject(name: string, instructions?: string): Promise<{ ok: boolean; id?: string; error?: string }>
export async function listProjects(): Promise<{ ok: boolean; items?: AiChatProject[]; error?: string }>   // 최신순, deleted_at IS NULL
export async function updateProject(id: string, patch: { name?: string; instructions?: string }): Promise<{ ok: boolean; error?: string }>
// ↑ update 시 `updated_at = now()` 명시 갱신(ai_projects에는 touch 트리거 없음 — 04 §6-2)
export async function softDeleteProject(id: string): Promise<{ ok: boolean; error?: string }>   // deleted_at=now(), 연결 대화는 project_id 유지(FK SET NULL 아님 — 소프트삭제)
// 대화-프로젝트 연결
export async function setConversationProject(conversationId: string, projectId: string | null): Promise<{ ok: boolean; error?: string }>
// 지식
export async function addKnowledgeText(projectId: string, text: string, source: string): Promise<{ ok: boolean; chunks?: number; embedded?: number; error?: string }>
export async function listKnowledge(projectId: string): Promise<{ ok: boolean; items?: { source: string; chunks: number; createdAt: string }[]; error?: string }>  // source 단위 그룹
export async function deleteKnowledgeSource(projectId: string, source: string): Promise<{ ok: boolean; error?: string }>
```
- 모든 액션 서두: 세션1과 동일하게 `requireAdmin` + 대상 행 `user_id = auth.uid()` 검증 후 `createAdminClient()`로 write.
- 파일 업로드 지식: `POST /api/admin/ai-chat/knowledge-upload` — 세션2 업로드 API 패턴 복제. 허용 타입: 텍스트 계열(`text/plain`, `text/markdown`, `text/csv`; 상한 1MB) + **docx/xlsx/pptx·PDF(상한 10MB)** — 세션2 `extractDocumentText`(officeparser, 04 §8) 재사용으로 텍스트 추출(추출 실패 시 `{ok:false}` 400). 추출 텍스트를 `addKnowledgeText`로 위임. URL fetch 기능 없음(SSRF 차단).

### 3-2. 임베딩 파이프라인 — `apps/web/lib/ai-chat/knowledge.ts` + `lib/gemini-embedding.ts` 비파괴 확장

```ts
// lib/gemini-embedding.ts — 시그니처 확장(기존 호출처 무변경: 옵션 파라미터)
export async function embedText(
  text: string,
  apiKey: string,
  userId?: string | null,
  opts?: { taskType?: 'CLUSTERING' | 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'; feature?: AiFeature },
): Promise<EmbedResult | null>
// 기본값 taskType='CLUSTERING', feature='memo-embedding' → 기존 메모 경로 동작 불변(회귀 0)
```

```ts
// lib/ai-chat/knowledge.ts (순수부는 단위테스트 대상)
export function chunkText(text: string, opts?: { size?: number; overlap?: number }): string[]
// 기본 size=1500자, overlap=200자, 문단(\n\n) 경계 우선 분할. embedText의 2000자 slice 이내 보장.

export async function embedKnowledgeChunks(projectId: string, source: string, chunks: string[], userId: string): Promise<number>
// 청크별 embedText(..., {taskType:'RETRIEVAL_DOCUMENT', feature:'ai-chat'}) → toVectorLiteral → insert.
// 실패 청크는 embedding NULL로 저장(검색 제외, 재시도 여지). 토큰은 token-logger 경유 자동 기록.

export async function retrieveProjectContext(
  projectId: string, query: string, userId: string, apiKey: string,
  opts?: { k?: number; minSim?: number },                 // 기본 k=5, minSim=0.35
): Promise<{ content: string; source: string; similarity: number }[]>
// embedText(query, ..., {taskType:'RETRIEVAL_QUERY'}) → rpc('match_ai_project_knowledge', {...})

export function buildProjectSystemBlock(
  instructions: string | null,
  hits: { content: string; source: string }[],
): string   // 순수 함수 — 주입 프롬프트 조립(테스트 대상)
```

### 3-3. 대화 시 컨텍스트 주입 — `POST /api/admin/ai-chat/stream` 확장

주입 순서(시스템 프롬프트 합성 — 우선순위 명시):
```
[1] 대화별 system_prompt (세션2)
[2] 프로젝트 instructions (ai_projects.instructions)
[3] 프로젝트 지식 top-k:
    <project_knowledge>
    아래는 이 프로젝트에 등록된 참고 지식이다. 관련 있을 때만 인용하고, 출처(source)를 밝혀라.
    [source: {source}] {content}
    ...
    </project_knowledge>
```
- 트리거: 대화의 `project_id`가 있고 지식이 1건 이상일 때만. 쿼리 = **직전 사용자 메시지 원문**(첨부 제외). 임베딩 실패/0건 히트 시 [3] 생략하고 정상 진행(응답 차단 금지 — `embedText` null-safe 철학 유지).
- 지식 블록은 데이터로 취급 — 지시 승격 금지 문구를 래퍼에 포함(프롬프트 인젝션 완화).

### 3-4. UI
- `app/admin/ai-chat/projects/page.tsx`(서버: `listProjects`) + `ProjectsClient.tsx`: 프로젝트 카드 목록(`responsive-grid-cols-3`) + 생성/편집 모달(모달 표준 §2-2 준수, `input-field`/`label` 클래스).
- `app/admin/ai-chat/projects/[id]/page.tsx`: 프로젝트 상세 — instructions 편집, 지식 목록(source 그룹, 청크 수, 삭제), 텍스트 붙여넣기/파일 업로드, 이 프로젝트의 대화 목록(→ `/admin/ai-chat?c=`) + "이 프로젝트에서 새 대화".
- 채팅 화면: 대화 헤더에 프로젝트 셀렉트(연결/해제 = `setConversationProject`), 사이드바 대화목록에 프로젝트 뱃지(`NbBadge`). 사이드바 상단에 "프로젝트" 링크.

---

## 4. 툴 (Provider Server Tools)

### 4-1. 인터페이스 확장 — `lib/ai-chat/provider.ts`

```ts
// 세션 1의 콜백+Promise 스타일 유지(04 §4 확정 — AsyncIterable 표기 폐기, 입력 필드는 `turns`).
// 확장은 전부 옵션 필드/콜백 추가만 — 하위 세션 호출부 무수정 호환.
export interface ChatToolsOption { webSearch?: boolean }        // v1은 web_search만

// StreamChatParams(세션 1 정의)에 추가:
//   tools?: ChatToolsOption                                    // capabilities.tools=false 프로바이더에 지정 시 서버 400
//   onCitation?: (c: AiChatCitation) => void                   // 출처 이벤트(누적→카드 렌더, 중복 url dedupe는 호출측)
//   onToolStatus?: (s: 'searching' | 'done') => void           // "웹 검색 중…" 인디케이터
// StreamChatResult(세션 1 정의)에 추가:
//   citations?: AiChatCitation[]                               // 스트림 종료 시 수집분(저장용)

// ProviderCapabilities는 세션 1의 4필드 { vision, tools, thinking, defaultMaxOutputTokens } 그대로 —
// 이 세션은 tools 필드의 "소비"만 시작(선언 변경 없음).
```

### 4-2. 프로바이더별 매핑 차이 표

| 항목 | Claude (`claude.ts`) | Gemini (`gemini.ts`) | OpenAI (`openai.ts`) |
|------|---------------------|----------------------|----------------------|
| capability.tools | **true** | **true** | **false** (v1) |
| 요청 파라미터 | `tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }]` (opus-4-8 등 4.6+; 구모델 폴백 `web_search_20250305`) | `tools: [{ google_search: {} }]` (generateContent v1beta) | 미전달 — `chat.completions`는 server web search 미지원. Responses API 전환은 범위 외 |
| 스트림 이벤트 | `server_tool_use` 블록 시작 → `onToolStatus('searching')`; `web_search_tool_result` 블록 → 결과의 `web_search_result[]`(url/title)를 `onCitation`으로 방출; text 블록의 `citations` 배열도 동일 매핑 | 청크 `candidates[0].groundingMetadata.groundingChunks[].web.{uri,title}` → `onCitation` 방출(중복 uri dedupe) | — |
| 종료 특이 | `stop_reason: 'pause_turn'` 처리: assistant content 재전송으로 재개, **최대 3회** 상한 | 없음 | — |
| 과금 주의 | web_search 사용량 과금 — `max_uses:5` 상한 고정 | grounding 과금 | — |

### 4-3. 게이팅·저장·렌더
- **게이팅**: Composer에 "웹 검색" 토글(지구본 아이콘). `registry`의 `capabilities.tools===false`인 프로바이더 선택 시 토글 비활성+툴팁("이 프로바이더는 웹 검색을 지원하지 않습니다") — 세션2 vision 게이팅과 동일 패턴. 토글 상태는 요청 단위(body `{tools:{webSearch:true}}`)로 전달, 저장하지 않음.
- **저장**: 스트림 종료 시 수집된 citation 배열을 assistant 메시지의 `ai_messages.citations jsonb`에 저장(마이그레이션 152 §1-5항 포함). content에 덧붙이지 않는다 — 근거: 복원 시 출처 카드 재표시 필요 + content 오염 금지(export·artifact 파서와 충돌 방지).
- **렌더**: `MessageList`에 `CitationCards.tsx` — 메시지 하단 출처 칩 목록(favicon+title+도메인, `rel="noopener noreferrer" target="_blank"`). 스트리밍 중 `toolStatus:'searching'`이면 "웹 검색 중…" 인라인 인디케이터(`AXDotLoader` 재사용).
- 단위테스트: citation 매핑 순수부(Claude `web_search_tool_result`→`AiChatCitation`, Gemini groundingChunks→`AiChatCitation` 변환 함수를 각 어댑터에서 export하여 테스트).

---

## 5. 공유 / 내보내기 / 분기 네비게이션 / 부가

### 5-1. Markdown Export
```ts
// lib/ai-chat/export.ts (순수 함수 — 단위테스트 대상)
export function conversationToMarkdown(
  conv: { title: string; provider: string; model: string; createdAt: string },
  messages: { role: 'user' | 'assistant'; content: string; createdAt: string;
              citations?: { url: string; title: string }[] }[],
): string
```
- 포맷: `# {title}` + 메타(provider/model/일시 — KST 표기는 `lib/datetime/kst.ts`의 `formatKstDateTimeShort` 사용) + `## 👤 사용자` / `## 🤖 어시스턴트` 섹션 반복 + 출처는 각 메시지 말미 각주 목록. 코드펜스 원문 보존(이스케이프 불필요 — 이미 마크다운).
- 라우트: `GET /api/admin/ai-chat/export?c=<conversationId>` — admin 인가 + owner 검증 → `Content-Disposition: attachment; filename="{sanitize(title)}.md"`. UI: 대화 헤더 메뉴에 "내보내기(.md)".

### 5-2. 공유 옵트인 (확정 — admin 경계 내)
- **결정: 공개 인터넷 공유는 채택하지 않는다.** dateam은 `middleware.ts`가 전 경로 인증 강제하는 내부 어드민 도구 — 공개 라우트 신설은 인증 경계 훼손(미들웨어 예외 추가+토큰만으로 열람)이라 이익 대비 위험이 큼.
- **확정 범위 = "admin 간 공유"**(마이그레이션 153): owner가 옵트인(`shared=true` + `share_token` 발급) → 다른 admin이 `GET /admin/ai-chat/shared/[token]` 접근 → 페이지 서버 컴포넌트가 `requireAdmin` 후 service_role로 `shared=true AND share_token=? AND deleted_at IS NULL` 조회 → **read-only 뷰**(입력창 없음, "읽기 전용 — {owner}의 공유 대화" 배너).
- 정책: RLS는 owner 격리 그대로(정책 완화 금지) — 공유 열람만 서버가 명시 검증 후 제공. 토큰=`gen_random_uuid()` 텍스트(128bit), 서버액션 `toggleShare(conversationId, on: boolean) → { ok, token?, error? }`(off 시 `share_token=NULL`로 즉시 무효화). 공유 상태 뱃지·해제 UI 필수.

### 5-3. LaTeX (KaTeX)
- 신규 의존성: `katex`, `remark-math`, `rehype-katex` (`pnpm add`). `katex/dist/katex.min.css`는 `app/admin/ai-chat` 진입 클라이언트에서 import(전역 오염 회피).
- `MarkdownMessage.tsx`: `remarkPlugins: [remarkGfm, remarkMath]`, `rehypePlugins: [..., rehypeKatex]`. 인라인 `$...$`·블록 `$$...$$` 지원. KaTeX 출력은 `trust: false`(기본) 유지 — HTML 주입 차단. 렌더 실패 수식은 원문 표시(throwOnError:false).

### 5-4. 비용 대시보드 — 기존 `/admin/ai-usage` 확장 (신규 화면 금지)
- `AiUsageDashboard.tsx` 확장: (a) **provider 필터/그룹**(150에서 추가된 `ai_token_logs.provider`; NULL=legacy Gemini로 표기), (b) provider·model별 월 토큰 합계 테이블(`.table-base .table-card` — 모바일 카드 패턴), (c) **추정 비용 컬럼**.
- 단가 SSOT: `lib/ai-chat/pricing.ts` — `PRICE_PER_MTOK: Record<string, { in: number; out: number }>`(예: `'claude-opus-4-8': {in:5, out:25}`, `'claude-fable-5': {in:10, out:50}`, gemini/openai 상위 모델). 미등록 모델은 비용 `-` 표기(토큰만). `estimateCostUsd(model, promptTokens, outputTokens)` 순수 함수.
- 집계 쿼리: 서버 컴포넌트에서 `ai_token_logs`를 월 범위(`kstRangeToUtc`)로 조회 → `feature`/`provider`/`model` 그룹 합산. 기존 `ai_token_alert_threshold` 가드 로직은 무변경.

### 5-5. 편집분기 브랜치 네비게이션 (`‹ k/n ›` 전환 · 과거 분기 열람) — 확정 설계

**범위 확정**: 과거 분기의 **열람·전환**을 제공한다. 전송·재생성·편집은 항상 **활성(최신) 스레드**에서만 — 세션 2의 시간순 리플레이 SSOT(`buildActiveThread`, S2 §5-2)를 유지하며, 과거 분기를 다시 활성화하는 트리 포인터 모델(스키마 개편)은 도입하지 않는다(설계 결정 — 유예 아님). 데이터 모델은 151 `parent_message_id`로 완결(추가 마이그레이션 없음).

**순수 함수 확장 — `lib/ai-chat/thread.ts` (S2 파일에 동거, 단위테스트 대상)**

```ts
/** parent_message_id 체인으로 "버전 그룹" 구성: 원본(그룹 내 parent 없는 user 메시지)을 root로,
 *  그 파생 편집 전체(편집의 편집 포함)를 created_at asc로 나열. 그룹 크기 1(무편집)은 미포함. */
export function getBranchGroups(sorted: ThreadMsg[]): Map<string /* rootId */, string[] /* versionIds asc */>

/** 그룹별 선택 버전으로 리플레이해 열람용 스레드 구성.
 *  - choices 미지정 그룹 = 최신 버전(기본) → buildActiveThread(sorted) ≡ buildThreadForChoice(sorted, {})
 *  - 선택 제외된 버전을 만나면 skip 모드 진입: 이후 parent 없는 메시지(그 분기의 꼬리)도 제외,
 *    선택 버전을 절단·append하는 시점에 해제. → 원본 버전 선택 시 과거 꼬리(a2 u3 a3 …)까지 복원 표시.
 */
export function buildThreadForChoice<T extends ThreadMsg>(sorted: T[], choices: Record<string, string>): T[]
```

**서버 — `getMessages` 확장(봉투·기존 필드 불변, 04 §6-2)**: 입력에 `choices?: Record<string /*rootId*/, string /*versionId*/>` 옵션 추가(지정 시 `buildThreadForChoice` 기준으로 스레드 구성). 반환 items의 user 메시지에 `branch?: { rootId: string; index: number; count: number }` 메타 부가(버전 그룹 크기 ≥2일 때만, index=표시 중 버전의 1-base 순번).

**UI**
- user 버블 하단에 `‹ k/n ›` 네비(그룹 크기 ≥2일 때만, 보조 컨트롤 — 클릭영역 32px 이상). 클릭 시 클라가 choices 갱신 → `getMessages({ conversationId, choices })` 재조회(또는 보유 전체 메시지로 로컬 재계산) → 스레드 전환 렌더.
- 선택 상태 URL 동기화: `?c=<id>&b=<rootId>.<versionId>`(다중 그룹은 콤마 연결) — 새로고침/링크 공유 시 열람 분기 복원(URL state 컨벤션).
- **과거(비활성) 분기 열람 중**: Composer 비활성 + 상단 배너 "과거 분기 열람 중 — 이어쓰려면 최신 분기로 돌아가세요" + [최신 분기로] 버튼(choices 초기화). 재생성·편집 액션도 열람 모드에서는 숨김.

**테스트(`lib/ai-chat/thread.test.ts` 확장)**: ① `getBranchGroups` — 단일 그룹/편집의 편집(중첩)/다중 그룹 분리 ② `buildThreadForChoice` — 기본(빈 choices) ≡ `buildActiveThread` ③ 원본 버전 선택 시 과거 꼬리 포함 복원 ④ skip 모드에서 비활성 꼬리 제외 ⑤ 중간 버전 선택.

---

## 6. 신규 의존성
`katex`, `remark-math`, `rehype-katex` — 3개만. (mermaid 파서 추가 금지(코드 표시만) — pdf/office 텍스트 추출은 세션 2 `officeparser` 재사용, 04 §8.) `pnpm add` 후 typecheck.

---

## 7. 테스트 전략

| 테스트 파일 | 대상 (순수부) |
|-------------|--------------|
| `lib/ai-chat/artifacts.test.ts` | 추출 규칙(승격 조건 경계 15줄/800자, html 무조건, 인라인 제외), title 추론·sanitize, identity 버전 그룹핑(`buildArtifactVersions`) |
| `lib/ai-chat/knowledge.test.ts` | `chunkText`(경계·overlap·2000자 이내), `buildProjectSystemBlock`(0건 히트 시 빈 문자열, 래퍼 포함) |
| `lib/ai-chat/export.test.ts` | `conversationToMarkdown`(코드펜스 보존, citations 각주, 파일명 sanitize) |
| `lib/ai-chat/pricing.test.ts` | `estimateCostUsd`(등록/미등록 모델) |
| `lib/ai-chat/thread.test.ts` (확장) | `getBranchGroups`·`buildThreadForChoice`(§5-5 — 기본 ≡ buildActiveThread, 원본 선택 시 꼬리 복원, skip 모드) |
| (어댑터) citation 매핑 함수 | Claude/Gemini 응답 조각 → `AiChatCitation` 변환 |

- 러너: node:test — **`apps/web/package.json`의 `test` 파일 목록에 신규 테스트 명시 추가 필수**(자동 포함 아님).
- `pnpm exec tsc --noEmit` 0 에러, `pnpm design:check` 통과.
- 수동 검증(문서화): (1) 프로젝트 지식 업로드(텍스트·docx·PDF)→새 대화에서 지식 기반 답변+출처, (2) HTML artifact sandbox에서 외부 fetch 차단 확인(devtools), (3) Claude/Gemini web_search 출처 카드, OpenAI 토글 비활성, (4) export .md 열람, (5) LaTeX 수식, (6) ai-usage provider별 비용, (7) 편집분기 `‹ k/n ›` 전환·과거 분기 열람·URL 복원·열람 중 Composer 잠금, (8) 공유 토큰 발급→타 admin read-only 열람→해제 즉시 무효.

## 8. 완료기준 체크리스트 (Feature Defaults 전개 · 배치 3 = 확정 완성 스펙의 해당 항목 100%)

**Artifacts**
- [ ] 코드/HTML/markdown 펜스 → 칩 → 우측 패널(미리보기/코드 탭)
- [ ] HTML sandbox iframe: `allow-scripts`만 + srcDoc CSP(`connect-src 'none'`) + `no-referrer`
- [ ] 버전 셀렉터(identity별 v1..vN)·복사·다운로드(확장자 맵)
- [ ] 스트리밍 완료 후 파싱(불완전 펜스 미노출) · 모바일 오버레이

**Projects (CRUD 4종 + List 어포던스)**
- [ ] 프로젝트 Create/Read(목록·상세)/Update(`updated_at=now()` 명시 갱신)/소프트Delete + 최신순 목록 — 전 액션 `{ok, …, error?}` 봉투
- [ ] 지식: 텍스트/파일(text계 1MB + docx/xlsx/pptx·PDF 10MB — officeparser 추출) 업로드 → 청크 → 임베딩(RETRIEVAL_DOCUMENT) → 저장, source 단위 목록·삭제
- [ ] 대화-프로젝트 연결/해제 UI + 대화 시 instructions+top-k(RETRIEVAL_QUERY, k=5, minSim=0.35) system 주입
- [ ] 임베딩 실패 시 대화 비차단 · `gemini-embedding.ts` 기존 메모 경로 회귀 0

**툴**
- [ ] capability.tools 게이팅(OpenAI 비활성+안내) · Claude `web_search_20260209`(pause_turn 재개 ≤3회) · Gemini `google_search`
- [ ] 출처 citation 저장(`ai_messages.citations`)·카드 렌더·복원 재표시 · "검색 중" 인디케이터

**분기 네비게이션 (§5-5)**
- [ ] `getBranchGroups`·`buildThreadForChoice` 순수 함수 + `buildActiveThread` 하위호환(빈 choices ≡ 기존 동작)
- [ ] `getMessages` choices 입력 + user 메시지 `branch` 메타(그룹 ≥2)
- [ ] user 버블 `‹ k/n ›` 네비·분기 전환 열람·URL `b=` 복원·과거 분기 열람 중 Composer 잠금+복귀 배너

**공유/내보내기/부가**
- [ ] 대화→markdown export 다운로드(owner 검증, KST 표기)
- [ ] 공유 옵트인(153): admin 인증 내 read-only·토큰 무효화·RLS 무변경
- [ ] LaTeX(remark-math+rehype-katex, trust:false) · 비용 대시보드(`/admin/ai-usage` 확장, pricing SSOT)

**공통 게이트**
- [ ] 마이그레이션 152·153 파일 생성 — 적용=사용자
- [ ] RLS: ai_projects/ai_project_knowledge admin+owner default-deny · RPC requester 검증 · pgvector ivfflat 인덱스
- [ ] 보안: iframe 격리 · SSRF 없음(URL fetch 기능 부재 확인) · 공유토큰(발급/무효화/서버 검증) · 지식 프롬프트 인젝션 래퍼 — 🟥 DC-SEC 집중 검토
- [ ] typecheck 0 · 단위테스트(목록 등록 포함) 통과 · design:check 통과 · 🟥 DC-REV
- [ ] 로컬 커밋 `v{버전}: ... claude` (push=사용자)

## 9. 배포 핸드오프 (루프가 직접 하지 않음 — EXEC-003 예외: 사용자 인증 필요)
- 마이그레이션 적용: `PGPASSWORD=… ./scripts/migrate.sh 152_ai_chat_projects.sql` + `153_ai_chat_share.sql` → **사용자**
  - 적용 전 확인: `\dx vector`(pgvector 활성 — 042에서 이미 활성) / 적용 후 `--status`로 추적 확인
- `! git push origin main` → **사용자**
