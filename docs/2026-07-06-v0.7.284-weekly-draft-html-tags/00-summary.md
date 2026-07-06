# FAST PATH Summary — 주간보고 AI 초안 `<ul><li>` 태그 노출 버그

작업: 주간보고 AI 자동선작성 초안의 편집 textarea에 `<ul><li>…</li></ul>` HTML 태그가 원문 그대로 노출되던 장애 수정 — AI 섹션 HTML을 불릿별 plain text 항목으로 분해하고, 이미 저장된 HTML 오염행은 읽기 시 방어 변환.

대상:
- `apps/web/lib/weekly-report/generate-draft.ts` — `rowsToItems`: AI가 반환한 섹션 HTML(`<ul><li>`)을 `htmlToPlain`(SSOT)으로 불릿별 plain 항목으로 분해(1섹션 1항목 → 불릿별 N항목).
- `apps/web/lib/weekly-report/draft-server.ts` — `rowToItem`: content에 HTML 태그가 있으면 `htmlToPlain`으로 방어 변환(v0.7.281로 이미 저장된 오염행 자동 복구).
- `apps/web/lib/weekly-report/generate-draft.test.ts` (신규) — 분해/plain 회귀 테스트.
- `apps/web/package.json` — 신규 테스트 파일 등록.

이유: AI 스타일가이드(`docs/weekly-report-ai-style.md`)가 Gemini에 `performance:"<ul><li>…</li></ul>"` **HTML** 출력을 지시(레거시 weekly_reports가 Tiptap HTML 저장). `rowsToItems`가 그 HTML 문자열을 plain 변환 없이 `item.content`(plain 텍스트 필드)에 넣어, 실제 렌더 경로 `AutoDraftItemList`의 `<textarea value={item.content}>`가 태그를 글자로 표시. CLAUDE.md §5-1(HTML→plain 필수) 위반.

영향:
- 표시: 텍스트에어리어에 깨끗한 불릿 텍스트, 항목별 체크박스/삭제(§5-3 후보 체크리스트 패턴과 일치).
- 저장 직렬화: `serialize.ts:itemsToWeeklyRows`가 불릿별 항목을 각각 `<li>`로 재래핑 → 레거시 weekly_reports 다건 불릿과 **동등**(취합·team/org 뷰 무변경).
- 캘린더 항목(`eventsToItems`)은 이미 plain — 변경 없음. DB 스키마 변경 없음.
