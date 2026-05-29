# FAST PATH Summary
작업: 주간보고 Tiptap 에디터 Tab키/공백 저장 후 소실 버그 수정
대상: apps/web/components/ui/TiptapEditor.tsx, apps/web/app/globals.css
이유: Tab 키가 포커스 이동(동작 없음), 다중 공백이 저장 후 표시 시 CSS 축소로 보이지 않음
영향: apps/web/components/ui/EditorModal.tsx (TiptapEditor 사용 — 수정 없음)

## 변경 사항
1. **TiptapEditor.tsx**: @tiptap/core의 Extension으로 TabIndent extension 추가
   - Tab 키: 리스트 안이면 들여쓰기(sinkListItem), 일반 단락이면  ×4 삽입
   - Shift-Tab: 리스트 안이면 내어쓰기(liftListItem)
2. **globals.css**: .tiptap-content p, .report-rich p에 white-space: pre-wrap 추가
   - 저장된 HTML의 연속 공백이 표시 시 축소되지 않도록 보장

## 테스트 결과 (Playwright)
- Tab 삽입 → DB에 c2a0×4 (non-breaking spaces) 저장 ✓
- 저장→새로고침 후 공백 유지 확인 ✓
- white-space: pre-wrap 적용 확인 (getComputedStyle) ✓
