# AI 채팅 클론 — 로드맵 · 결정 필요사항 (기획 전용)

## A. 완성 설계(전체 확정) — 의존성 순서 구현 배치 1/2/3

> 전체가 **확정 완성 스펙**(발견형 MVP 아님). 배치 분할 근거는 **오직 의존성**: 테이블·프로바이더 추상화(배치 1) → 첨부·UI 완성도(배치 2) → 고급(배치 3). 파일업로드·멀티모달은 `ai_attachments` 테이블 + Supabase Storage(admin 버킷) + 프로바이더 capability 매핑으로 배치 2에 확정 포함. 상세: 00·01 문서 + `sessions/04-implementation-contract.md`(SSOT).

### 배치 1 — 기반 + 핵심 채팅 (의존성 뿌리) · 예상 LARGE
1. **DB**: `ai_conversations`/`ai_messages` 마이그레이션 + RLS(admin+owner) + `ai_token_logs.provider` 컬럼 + `AiFeature 'ai-chat'` enum.
2. **프로바이더 추상화**: `lib/ai-chat/provider.ts`(인터페이스) + `providers/gemini.ts`(기존 SSE 래핑) + `providers/claude.ts`(`@anthropic-ai/sdk` 스트리밍) + **`providers/openai.ts`(`openai` SDK 스트리밍)** + `registry.ts`(META 기반 available 3종).
3. **어드민 설정**: Claude·OpenAI 키/모델 섹션 + `saveClaudeKey`/`saveOpenAiKey` 등 액션 + default provider.
4. **API**: `POST /api/admin/ai-chat/stream`(어댑터 선택·SSE·저장·토큰로깅) + 대화 CRUD 서버액션(생성/이름변경/소프트삭제/목록).
5. **UI**: `/admin/ai-chat` 사이드바+채팅패널, 스트리밍 훅 `use-sse-chat.ts`, 마크다운+코드블록 렌더러, 프로바이더/모델선택, Stop, 복사, 자동 제목.
6. **통합**: 좌측 메뉴 "AI채팅" + 페이지 내 대화 목록 사이드바(세션1 §7-2 확정) + 사이드바 "새 대화" 버튼(FAB 미도입 — 세션1 §7-3 확정).
7. **검증**: 스트리밍/복원/3-프로바이더 전환/권한차단 + 단위테스트(registry·provider 매핑) + 🟥 DC-REV/DC-SEC.

### 배치 2 — 멀티모달 + 완성도 (배치 1의 테이블·추상화에 의존)
재생성·메시지 편집분기·대화검색·pin 섹션 구분·대화별 시스템프롬프트·**이미지/파일 첨부(vision — docx/xlsx/pptx 서버 텍스트 추출 포함)**·thinking 표시(영속 복원)·피드백.

### 배치 3 — 고급 (배치 1·2 산출에 의존)
- **Artifacts**: 응답 내 코드/문서/HTML 프리뷰 패널(격리 렌더).
- **Projects**: 대화 그룹 + 프로젝트 지식(파일/지시) 컨텍스트 주입.
- **툴**: 웹검색(provider별 server tool — Claude web_search, Gemini google_search).
- **분기 네비게이션**: 편집분기 `‹ k/n ›` 전환·과거 분기 열람(세션3 §5-5 확정).
- **공유/내보내기**: 대화 export(md) + admin 경계 내 공유 옵트인(마이그레이션 153 — 확정. D1의 기본 격리는 RLS 그대로 유지).

> 3 프로바이더 × 고급기능(툴/vision/thinking)은 프로바이더별 능력 차이가 큼 → 추상 인터페이스에 **capability 플래그**(supportsVision/supportsTools/supportsThinking)를 두고 대화 UI에서 해당 프로바이더가 지원하는 기능만 노출.

## B. 새 의존성 (검토)
- `@anthropic-ai/sdk` (Claude 프로바이더). 스킬 기준: 스트리밍 `messages.stream`, adaptive thinking, `claude-opus-4-8`.
- 마크다운: `react-markdown` + `remark-gfm` + `rehype-highlight` + raw HTML 비활성(`skipHtml`) — DOMPurify 미도입(04 §8). → 결정 D5.
- `openai` SDK — 배치 1 확정(3 프로바이더 동시 추상화).
- `officeparser` — 배치 2(docx/xlsx/pptx 첨부 + 배치 3 지식 office·PDF 텍스트 추출).

## C. 리스크 / 트레이드오프
- **범위**: "100% 클론"은 Artifacts/Projects 포함 시 초대형 → **전체 확정 스펙을 의존성 순서 배치 1→2→3으로 순차 구현**(범위 축소·발견형 유예 없음).
- **멀티프로바이더 추상화**: 기존 `gemini-*.ts`를 리팩터하지 않고 **병렬 신설**로 회귀 0 (SSOT는 채팅 경로에 한정).
- **비용**: 스트리밍 LLM 대화는 토큰 소모 큼. provider별 로깅 + 알림 임계 필수.
- **admin 간 데이터 격리**: 소유자 스코프면 admin끼리 서로 대화 안 보임(기본). 공유 요구 시 정책 변경.

## D. 결정 확정 (2026-07-13 사용자 승인)

- **D8. 범위 = 전체 클론 확정** — Artifacts·Projects·툴·공유·분기 네비게이션까지 전량 확정 스펙. (물리적으로 한 번에 불가 → 의존성 순서 배치 1/2/3으로 순차 구현.)
- **D2. 프로바이더 = Gemini + Claude + OpenAI** 3종 모두 어댑터 신설.
- **D1. 소유 범위 = 어드민 각자 본인 대화만** (owner 스코프 RLS, admin 간 격리. 공유는 배치 3의 옵트인 토큰 — RLS 무변경).
- **D3. 대화 목록 = `/admin/ai-chat` 페이지 내 `ConversationSidebar`로 렌더** (세션1 §7-2 확정 — 글로벌 admin 네비(MobileShell) 개조는 (member) 전 화면 영향 리스크로 기각).

### 기술 기본값 (CEO 확정 — 미지정 시 이대로 진행)
- **D5. 마크다운 = `react-markdown` + `remark-gfm` + `rehype-highlight`** (스트리밍/보안 우수) + raw HTML 비활성(`skipHtml`) — **DOMPurify 미도입**(04 §8).
- **D6. 제목 자동생성 = 대화의 provider/model 재사용** (저비용 티어로 1콜).
- **D7. Claude 기본 모델 = `claude-opus-4-8`** (스킬 권고). Gemini/OpenAI는 admin이 설정한 모델.
- **D4. 첨부(이미지/파일) = 배치 2** (vision 지원 프로바이더 한정, docx/xlsx/pptx 서버 텍스트 추출 포함).

## E. 완료기준 (배치 1 — 신규 테이블 Feature Defaults 자동전개 · 완성 스펙 100% 기준)
- [ ] CRUD: 대화 생성/조회/이름변경/**소프트삭제** (+각 연산 admin+owner 권한)
- [ ] List: 대화 목록(최신순) + **RLS admin-only + owner 스코프(default-deny)**
- [ ] 검색: 대화 제목/본문은 배치 2 구현(스펙 확정) — 배치 1은 목록·페이지네이션
- [ ] 성능: 대화/메시지 페이지네이션(메시지 커서 로드)
- [ ] 상태 URL 동기화(`?c=<id>`) + 로딩/빈/에러 3종
- [ ] 스트리밍·중단·복사·자동제목·프로바이더전환·권한차단·토큰로깅(provider)
- [ ] typecheck·단위테스트(registry/provider)·🟥 DC-REV·🟥 DC-SEC
- [ ] 마이그레이션 적용(사용자) + git push(사용자) — 정책상 사용자 실행

> 구현은 하지 않았다. D1~D8 확정 후 상세설계 완료: `sessions/session-1~3` + `sessions/04-implementation-contract.md`(단일 구현 계약 — SSOT) + `sessions/00-loop-runbook.md`.
