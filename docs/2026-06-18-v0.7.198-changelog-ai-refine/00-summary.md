# v0.7.198 — 체인지로그 AI 정제 버튼

## 작업
어드민 체인지로그 편집 모달에 **"AI 정제" 버튼** 추가 — git에서 가져온 커밋 원문(내부표현 포함)을
기능 단위 사용자 친화 콘텐츠로 다듬어 미리보기(편집/저장은 어드민). 게시된 내역을 톤·형식 few-shot 참고.

## 수정/추가 파일
- 신규 lib/changelog/refine-prompt.ts (프롬프트 빌더+파서, 순수) + refine-prompt.test.ts(5)
- 신규 app/api/admin/changelog/refine/route.ts (requireAdminApi→Gemini callGeminiOnce→sanitizeChanges, 게시 5건 few-shot)
- app/admin/changelog/ChangelogAdmin.tsx — EditModal "AI 정제" 버튼+runRefine

## 이유
커밋 메시지에 "Playwright 검증/claude/E2E" 등 내부 표현이 그대로 노출 → 기능 단위로 정제 필요(사용자 요청).

## 영향 / 정책
- 기존 changelog 기능에 버튼 1개·라우트 1개 추가(파급 최소). AI UX '생성형'(미리보기/편집/저장, 자동저장 금지) 준수.
- SSOT: callGeminiOnce·sanitizeChanges 재사용. 결과 type/상한은 sanitizeChanges로 정규화.

## 검증
tsc·단위 251·design·build·Playwright(정제 200, claude/Playwright 제거 + 회귀 4/4).
