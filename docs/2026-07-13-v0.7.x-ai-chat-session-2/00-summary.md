# 세션2 구현 요약 (DOC-FIRST)

> 상위 설계(요구/아키텍처/태스크/테스트)는 `docs/2026-07-13-ai-chat-clone-plan/`의
> `00-requirements.md`·`01-architecture.md`·`03-feature-manifest.md` +
> `sessions/session-2-multimodal-completeness.md`(상세) + `sessions/04-implementation-contract.md`(SSOT)가 담당.
> 본 폴더는 세션2 루프의 실행 요약 + 완료기준 + 세션1 결합부 integration-spec만 둔다(중복 방지).

## 작업 요약
dateam AI 채팅(Claude 클론)의 배치2: 파일업로드·멀티모달(office 텍스트 추출 포함) + 완성도 7종
(재생성·편집분기·검색·pin 섹션·시스템프롬프트·thinking 영속표시·피드백).

## 병행 실행 컨텍스트
세션 1·2·3 동시 진행. 04 계약이 인터페이스를 고정 → 병렬 구현 가능.
- **격리 worktree** `feature/ai-chat-session-2` (C:/Users/Administrator/dateam-s2) 에서 작업.
- 세션1 소유 파일은 **직접 수정 금지**(미완성 작업 손상 방지) → `05-integration-spec.md`로 정밀 명세.

## 수정/생성 파일 (2분류)

### A. 세션2 단독 소유 — 완전 구현 (이 브랜치에 실제 파일 생성)
| 파일 | 내용 | 검증 |
|---|---|---|
| `supabase/migrations/151_ai_chat_attachments.sql` | ai_attachments + ai_messages 2컬럼 + Storage 버킷/정책 | SQL 문법 |
| `apps/web/lib/ai-chat/attachments.ts` | 규칙 SSOT + 매핑 순수함수 | 단위테스트 |
| `apps/web/lib/ai-chat/thread.ts` | buildActiveThread | 단위테스트 |
| `apps/web/lib/ai-chat/search.ts` | sanitizeSearchQuery | 단위테스트 |
| `apps/web/lib/ai-chat/{attachments,thread,search}.test.ts` | §7 케이스 | node --test 실행 |
| `apps/web/app/api/admin/ai-chat/upload/route.ts` | POST 업로드 + DELETE 취소 | 코드리뷰(격리 tsc 불가) |
| `apps/web/app/admin/ai-chat/SystemPromptModal.tsx` | 모달 5체크리스트 | design 대조 |

### B. 세션1 소유 — integration-spec 명세 (직접수정 금지, 머지 시 적용)
`provider.ts` · `types/database.ts` · `providers/{claude,gemini,openai}.ts` · `stream/route.ts` ·
`actions.ts` · `Composer.tsx` · `MessageList.tsx`(MessageBubble) · `ConversationSidebar.tsx` ·
`AiChatClient.tsx` · `package.json`(officeparser + test 목록) → `05-integration-spec.md`.

## 변경 이유
설계서/런북에 명시된 3세션 분할(의존성 기준). 세션2는 세션1 토대에 멀티모달+완성도를 얹음.

## 영향 범위
`/admin/ai-chat` 어드민 전용 기능. 기존 (member)/기타 admin 화면 무영향.
DB: 신규 테이블 1 + 기존 ai_messages 컬럼 2 + Storage 버킷 1. 기존 스키마 무변경.

## 검증 경계 (투명성)
- 격리 실행 가능: 순수 모듈 단위테스트 3계열(thread·search·attachments) — 타입 import는 런타임 스트립.
- 세션1 머지 후 확정: 전체 `tsc --noEmit` green(결합부), 수동 3프로바이더 멀티모달, design:check 전체.
