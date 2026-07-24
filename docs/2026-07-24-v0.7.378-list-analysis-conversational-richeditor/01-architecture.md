# 01 — 아키텍처

## A. 데이터 모델 (마이그레이션)

### 마이그 175 — 원본 보존 (R1-2)
`ai_analysis_sessions`에 컬럼 추가(additive, 기존 무영향):
- `source_html text` — 리치 에디터 원본 HTML 무손실.
- `source_format text not null default 'plain'` — 'plain' | 'html' (읽기 분기).
- `source_text`(기존)는 **마크다운 정규화본**을 계속 저장(AI·그룹핑·검색 SSOT).

### 마이그 176 — 항목별 대화 (R2)
신규 `ai_analysis_item_messages`:
- `id uuid pk`, `session_id`, `item_idx int`, `revision int`, `role text('user'|'assistant')`, `content text`, `seq int`, `created_at`.
- FK `session_id → ai_analysis_sessions on delete cascade`. RLS owner-only(157 패턴 재사용).
- 인덱스 `(session_id, item_idx, revision, seq)`.
- `ai_analysis_items.result_text`는 **항목 최종 확정본**(대화 종료 시 스냅샷) 유지 — 종합·export는 이걸 읽음(무변경 호환).

## B. 구조 충실도 파이프라인 (R1) — 3단 체인 (SSOT)

```
리치에디터(HTML) ──저장──▶ source_html(원본) + source_text(md 정규화)
                              │
                    htmlToMarkdown(신규, 표→파이프표)   ◀── html-to-plain은 손대지 않음(폭발반경 차단)
                              ▼
                    cut-groups (표 블록 인식 추가) ──▶ 그룹(의미블록)
                              ▼
                    AI(마크다운 파이프표 입력) ──▶ 항목 결과(md)
                              ▼
        RichText(표 화이트리스트 확장) 렌더 · export(md/txt/docx/pdf 표 보존)
```

- **신규 `lib/ai-chat/html-to-markdown.ts`**: 리치HTML→마크다운(표=`| a | b |`+`|---|`, 헤딩 `#`, 리스트). **기존 `lib/html-to-plain.ts`는 변경 금지**(주간보고·회의노트 등 14+ 호출부 회귀 차단). 이 기능 전용 변환기.
- **cut-groups**: 파이프 표 블록(`^\s*\|.*\|\s*$` 연속행)을 하나의 원자 블록으로 묶어 절단 경계가 표를 가로지르지 않게(R1-4).
- **RichText.tsx**: `ALLOWED_TAGS`에 `table|thead|tbody|tr|td|th` 추가 + 속성 전량 제거 유지(XSS). `report-rich` 표 스타일 globals.css 토큰으로.
- **Tiptap**: `@tiptap/extension-table`(+row/cell/header) 추가. 공용 `TiptapEditor`에 옵션 플래그로 표 확장(주간보고/회의노트 영향 0 — 기본 off, analyze만 on).

## C. 대화형 흐름 (R2)

- `step: 'input' | 'groups' | 'converse' | 'results'`. groups 후 항목 클릭 → converse(항목 채팅) → 종합 시 results.
- 항목 채팅 서버액션: `sendItemMessage(sessionId, itemIdx, userText)` → `ai_analysis_item_messages` append(user) → Gemini(항목 원문+대화이력+지시) → append(assistant) → 반환. 재열람 = 메시지 로드(재호출 아님, ③ 원칙 계승).
- 항목 "확정" → `result_text`에 최종 assistant본 스냅샷 → 종합 대상 편입.
- 기존 일괄 심화(runItem/refineGroupItem)는 **폴백**으로 존치(대화 안 하고 바로 종합하는 사용자용) — 브레이킹 회피.

## D. 리스크 / 놓치기 쉬운 지점 (R3 — 박제)
1. **유실0 계약**: 원본(source_html)은 저장 전 반드시 확보. md 정규화 실패해도 원본은 남긴다.
2. **html-to-plain 미변경**: 신규 변환기로 격리(폭발반경 0).
3. **regroup 일관성**: 재그룹도 md 정규화본(source_text) 기준 → 표 인식 공유.
4. **상호배타 UX**: 리치에디터 입력 시 파일첨부 상호배타 재검토(에디터에 파일 드롭 병합은 차기).
5. **토큰비용**: 마크다운 표가 HTML보다 저렴 — 정규화본만 AI에.
6. **officeparser 표 실측**: xlsx→md 파이프표 여부 실업로드 검증(구현 전).
7. **대화 영속/재열람**: item_messages 로드 전용, 재진입 시 AI 재호출 금지.
8. **종합 반영**: 종합은 result_text(대화 확정본) 기준 — 대화 내용이 최종 문서에 반영됨.
9. **RLS·소프트삭제**: item_messages도 owner-only + 세션 cascade.
