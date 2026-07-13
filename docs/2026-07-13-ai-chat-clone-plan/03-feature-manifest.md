# AI 채팅 클론 — 전체 기능 매니페스트 (완전 열거 · 기획 전용)

> 목적: "다 기획했다"의 근거. 포함되는 **모든 기능 항목**을 빠짐없이 나열.
> 배치 태그: **배치1**(기반·핵심 채팅 — 세션 1) / **배치2**(멀티모달·완성도 — 세션 2) / **배치3**(고급 — 세션 3). **전 항목이 확정 완성 스펙 — 분할 근거는 오직 의존성**(테이블·추상화 → 첨부·UI 완성도 → 고급). 세부 시그니처는 `sessions/04-implementation-contract.md`(SSOT).
> 모델 정책: 각 프로바이더 **고급(최상위) 모델 기본**. 어드민 전용.

## A. 대화 관리 (Conversation Management)
- A1. 새 대화 생성 (사이드바 "새 대화" 버튼 / 좌측 "AI채팅" 메뉴 / 빈 상태 버튼 — FAB 미도입 확정, 세션1 §7-3) — 배치1
- A2. 대화 목록(핀 우선→최신순, `/admin/ai-chat` 페이지 내 사이드바 — 세션1 §7-2 확정) — 배치1
- A3. 대화 DB 영속 + 새로고침/재방문 복원 — 배치1
- A4. 대화 이름 수동 변경 — 배치1
- A5. 대화 제목 자동 생성(첫 문답 기반) — 배치1
- A6. 대화 소프트삭제 + 복원(되돌리기 UI) — 배치1
- A7. 대화 고정(pin): 컬럼·토글·정렬=배치1, "고정됨/최근" 섹션 구분=배치2
- A8. 대화 검색(제목/본문) — 배치2
- A9. 대화 폴더/프로젝트 그룹핑 — 배치3(Projects)
- A10. 대화 URL 딥링크(`?c=<id>`) 동기화 — 배치1
- A11. 대화 내보내기(markdown) — 배치3
- A12. (owner 스코프) admin 각자 본인 대화만 — 배치1

## B. 메시징 / 대화 흐름
- B1. 멀티턴(활성 스레드 기준 최근 40턴 컨텍스트 전송) — 배치1
- B2. 사용자 메시지 전송(Enter/Shift+Enter 개행) — 배치1
- B3. 어시스턴트 응답 수신 — 배치1
- B4. 메시지 복사 — 배치1
- B5. 응답 재생성(Regenerate) — 배치2
- B6. 사용자 메시지 편집 후 재전송(분기/재실행) — 배치2
- B7. 응답 피드백(👍/👎) — 배치2
- B8. 대화별 시스템 프롬프트(persona/지시) — 배치2
- B9. 메시지 페이지네이션(긴 대화 커서 로드) — 배치1
- B10. 오류 메시지 + 재시도 — 배치1
- B11. 편집분기 브랜치 네비게이션(`‹ k/n ›` 전환·과거 분기 열람 — 세션3 §5-5) — 배치3

## C. 스트리밍 / 생성 제어
- C1. 스트리밍 응답(SSE, 토큰 점진 렌더 + 커서) — 배치1
- C2. 생성 중단(Stop, AbortController) — 배치1
- C3. 스트리밍 중 부분 저장/중단 복구 — 배치1
- C4. thinking(추론) 표시(지원 모델 — Claude adaptive summarized): SSE 방출·영속 저장(150 컬럼)=배치1, 접이식 표시·복원 재표시 UI=배치2
- C5. 토큰/사용량·비용 표시(`/admin/ai-usage` 확장) — 배치3

## D. 렌더링
- D1. 마크다운 렌더(제목/목록/표/링크/인용) — 배치1
- D2. 코드블록(문법 하이라이트 + 복사 버튼 + 언어 라벨) — 배치1
- D3. 인라인 코드/굵게/기울임 — 배치1
- D4. sanitize(raw HTML 비활성 `skipHtml` — DOMPurify 미도입, 링크 noopener) — 배치1
- D5. 수식(LaTeX) 렌더 — 배치3
- D6. Artifacts(코드/HTML/문서 미리보기 격리 패널) — 배치3
- D7. 스트리밍 중 점진 마크다운 파싱 안정화 — 배치1

## E. 멀티모달 / 파일업로드
- E1. 파일/이미지 업로드 UI(버튼·드래그·클립보드 붙여넣기) — 배치2
- E2. 지원 형식: 이미지(png/jpg/webp), PDF, 문서(txt/csv/md/json + docx/xlsx/pptx — 서버측 텍스트 추출(officeparser) 확정) — 배치2
- E3. Supabase Storage(admin 전용 버킷) 저장 + `ai_attachments` 메타 — 배치2
- E4. 프로바이더별 멀티모달 전달(Claude image/document 블록 / Gemini inline_data / OpenAI image_url·file — 전부 base64, 04 §4) — 배치2
- E5. 첨부 미리보기(썸네일/파일칩) + 삭제 — 배치2
- E6. 대화 복원 시 첨부 재표시(서명 URL 재발급 TTL 1h) — 배치2
- E7. 비전 미지원 프로바이더 선택 시 첨부 비활성 + 안내 — 배치2
- E8. 용량/개수/mime 화이트리스트 + 매직바이트 검증 — 배치2

## F. 프로바이더 / 모델 (Gemini + Claude + OpenAI)
- F1. 프로바이더 추상화 인터페이스(`lib/ai-chat/provider.ts` — 콜백+Promise `streamChat`, 04 §4) — 배치1
- F2. Gemini 어댑터(REST SSE 직호출) — 배치1
- F3. Claude 어댑터(@anthropic-ai/sdk, 스트리밍·thinking) — 배치1
- F4. OpenAI 어댑터(openai SDK, 스트리밍) — 배치1
- F5. 레지스트리: META에 키 설정된 프로바이더만 available — 배치1
- F6. 대화별 프로바이더/모델 선택 드롭다운(available만) — 배치1
- F7. **고급(최상위) 모델 기본값** + admin 오버라이드 — 배치1
- F8. capability 4필드(`vision/tools/thinking/defaultMaxOutputTokens`): 선언=배치1, vision 소비=배치2, tools 소비=배치3
- F9. 기본 프로바이더 지정(META `ai_chat_default_provider` — registry `getDefaultProvider`) — 배치1

## G. 어드민 설정
- G1. Claude API 키/모델 섹션(`saveClaudeKey`/`saveClaudeModel`/`getClaudeModels`) — 배치1
- G2. OpenAI API 키/모델 섹션 — 배치1
- G3. 기본 프로바이더 선택 UI(`saveAiChatDefaultProvider`) — 배치1
- G4. 모델 목록 조회(프로바이더별 동적 — `listModels(): Promise<string[]>`) — 배치1
- G5. 토큰 사용 알림 임계(기존 `ai_token_alert_threshold` 재사용, provider별) — 배치3(비용 대시보드와 동시)

## H. 데이터 / 영속 / 보안
- H1. `ai_conversations` 테이블(+RLS `aicc_admin_owner`, 소프트삭제) — 배치1
- H2. `ai_messages` 테이블(+RLS `aicm_admin_owner`, thinking·stopped·error 포함) — 배치1
- H3. `ai_attachments` 테이블(+RLS `aia_owner_admin`) — 배치2
- H4. `ai_token_logs.provider` 컬럼 + `AiFeature 'ai-chat'` TS union — 배치1
- H5. Supabase Storage admin 전용 버킷 정책 — 배치2
- H6. 모든 라우트 admin 서버 인가(GET/POST/stream/upload) — 배치1~
- H7. API 키 서버 전용(클라 노출 금지) — 배치1
- H8. 프롬프트 인젝션 방어(system_prompt는 admin값만) — 배치1
- H9. 프로젝트 지식 pgvector — 배치3

## I. 통합(진입점)
- I1. 좌측 메뉴 "AI채팅"(`admin/layout` ADMIN_NAV_GROUPS) — 배치1
- I2. 대화 목록 = `/admin/ai-chat` 페이지 내 `ConversationSidebar`(세션1 §7-2 확정 — 글로벌 네비 개조 기각) — 배치1
- I3. "새 대화" 진입점 = 사이드바 버튼·빈 상태·모바일 헤더 +(**FAB 미도입 확정** — 세션1 §7-3) — 배치1
- I4. `/admin/ai-chat` 라우트(자동 admin 게이팅) — 배치1
- I5. 디자인 토큰·반응형·모달 표준 준수 — 배치1~

## J. 관측 / 비용
- J1. 프로바이더/모델별 토큰 로깅 — 배치1
- J2. 비용 집계 대시보드(`/admin/ai-usage` 확장 + pricing SSOT) — 배치3
- J3. 에러/사용 로깅 — 배치1

## K. 고급 / 도구
- K1. 웹 검색 도구(프로바이더 server tool — Claude web_search, Gemini google_search; OpenAI는 미지원 확정) — 배치3
- K2. 출처(citation) 저장·카드 렌더·복원 재표시 — 배치3
- K3. Projects(대화 그룹 + 지식 컨텍스트 주입) — 배치3
- K4. Artifacts(격리 프리뷰 패널) — 배치3
- K5. 대화 공유(admin 경계 내 옵트인 토큰, 마이그레이션 153 — 확정. owner 기본격리 RLS 무변경) — 배치3
- K6. MCP/외부 커넥터 — **제외 확정**(내부 어드민 도구 범위 밖 — 00-requirements §6)

## L. 접근성 / UX
- L1. 키보드 내비/포커스 관리 — 배치2
- L2. 로딩/빈/에러 3종 상태 — 배치1
- L3. 자동 스크롤 + "맨 아래로" 버튼 — 배치1
- L4. 반응형(데스크탑/모바일) — 배치1
- L5. 다크/라이트 테마 토큰 — 배치1

---
**합계(고유 항목): 약 70+ — 전량 확정 완성 스펙.** 배치 분포 — 배치1(대화관리·채팅·스트리밍·렌더·프로바이더3종·통합·보안), 배치2(멀티모달 8 + 완성도 7), 배치3(고급: Artifacts·Projects·툴·공유·분기 네비게이션·LaTeX·비용).
