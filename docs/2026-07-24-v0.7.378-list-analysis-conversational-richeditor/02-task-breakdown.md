# 02 — 태스크 분해 (단계별, 각 단계 독립 커밋·검증)

## Phase 1 — 구조 충실도 파운데이션 (⑥⑦, additive·저위험 먼저)
- T1.1 `lib/ai-chat/html-to-markdown.ts` 신설 + 단위테스트(표·헤딩·리스트·중첩). 기존 html-to-plain 무변경.
- T1.2 `cut-groups`에 파이프 표 블록 원자화 + 테스트(표 중간 절단 금지 fixture).
- T1.3 `RichText.tsx` 화이트리스트 표 태그 추가 + globals.css 표 스타일(토큰). sanitize 속성제거 유지 테스트.
- T1.4 `@tiptap/extension-table`(+row/cell/header) 설치, `TiptapEditor`에 `enableTable` 옵션(기본 off).
- **커밋 v0.7.378** (tsc0 + 단위테스트 green).

## Phase 2 — 리치 에디터 입력 결선 (⑥, R1-1·R1-2)
- T2.1 마이그 175(source_html·source_format) 적용.
- T2.2 `AnalyzeClient` '자료 붙여넣기' → TiptapEditor(enableTable). 저장 시 원본 HTML + htmlToMarkdown 정규화본 둘 다.
- T2.3 `saveAnalysisSession`/`extractSourceText` 경로가 html/md 둘 다 수용. 붙여넣기↔파일 상호배타 UX 재조정.
- T2.4 officeparser xlsx→md 파이프표 실측(실업로드 로그).
- **커밋 v0.7.379** (실브라우저 표 붙여넣기 검증).

## Phase 3 — 출력물 구조 보존 (⑦, R1-5)
- T3.1 export(md/txt/docx/pdf)가 표를 보존하는지 점검·수정(conversationToMarkdown/docx/pdf 라우트).
- T3.2 재열람·문서상세 RichText 표 렌더 확인.
- **커밋 v0.7.380**.

## Phase 4 — 대화형 항목 지시 (④, R2) — HEAVY
- T4.1 마이그 176(ai_analysis_item_messages) + RLS.
- T4.2 `sendItemMessage`·`getItemMessages` 서버액션 + 항목 확정 스냅샷.
- T4.3 `step='converse'` UI: 항목 채팅 패널(지시↔AI, 다회차, 재열람 로드).
- T4.4 `analyzeItem.customInstruction` 죽은 경로 배선/정리. 기존 일괄 심화는 폴백 존치.
- T4.5 종합이 대화 확정본(result_text) 반영 확인.
- **커밋 v0.7.381** (실브라우저 대화 흐름 + 유실0 회귀 fixture).

## 공통 게이트 (매 Phase)
tsc 0 · 관련 단위테스트 green · design:check · 유실0 회귀 fixture · 실브라우저(가능 시) · 버전범프 4파일 · changelog는 어드민전용이라 사유명시 후 생략.
