# v0.7.302 — AI 채팅 개선 3건 (위치·다운로드·모델선택) + 크래시/제목 수정

## 배경
사용자 실사용 중 발견·요구. "멈추지 말고 다 개선하고 테스트해."

## 구현 (실브라우저 E2E 검증 완료)
**[선행 수정 — v0.7.301 커밋 952ede8]**
- **RSC 크래시**: 서버 컴포넌트가 `'use client'`(AiChatClient)에서 `PROVIDER_LABELS` import → RSC 매니페스트 오류로 페이지 크래시. `lib/ai-chat/labels.ts`로 이관해 해소.
- **새 대화 제목 실시간**: 서버 autoTitle(fire-and-forget Gemini)이 나중에 완료돼 목록이 '새 대화'로 남던 경합 → 제목 확정까지 폴링 재조회.

**[이번 — ③④⑤]**
- **③ 위치**: `/admin/ai-chat`(관리자 콘솔) → **`/ai-chat`(일반 앱 member 셸)**, admin 전용 유지. 신규 `app/(member)/ai-chat/page.tsx`(requireAdmin), 서버로딩 SSOT `admin/ai-chat/load.ts` 양쪽 공유, 구경로는 `/ai-chat` redirect, 메뉴 href 갱신, fullpane 높이 처리. **E2E: 좌측 사이드바 'AI 채팅'(admin) → member 셸 안에서 렌더 확인.**
- **④ 다운로드**: md 고정 → **md/txt/pdf/docx 포맷 선택 모달**. `export.ts`(txt/html), 신규 `export-pdf` 라우트(puppeteer, requireAdminApi), `export-docx.ts`(클라), `ExportFormatModal.tsx`. **E2E: 4개 포맷 모달 확인.**
- **⑤ 모델 선택**: 미리설정값만 → **DB 카탈로그(마이그156 `ai_model_catalog`, seed 11)에서 키 있는 프로바이더의 모델을 능력·컨텍스트·출시일과 함께 표시·선택 + 라이브 새로고침**. `model-catalog.ts`, actions `listModelCatalog`/`refreshModelCatalog`, `ModelPickerModal.tsx`, Composer select→모달버튼. **E2E: Gemini 탭 3모델 능력/출시일 표시 확인.**

## 검증
- `tsc --noEmit` 0 · **899 테스트** PASS · `design:check` 통과 · 마이그156 적용(카탈로그 11행)
- **실브라우저 E2E**: 페이지 크래시 없음 · ③④⑤ 모달 3종 실동작 스크린샷 확인

## 알려진 제약 (범위 밖)
- `/admin/ai-chat/projects`·`/shared/[token]` 서브라우트는 미이동 — 사이드바 '프로젝트' 클릭 시 admin 크롬으로 전환(기능 정상, 시각 전환만). 후속.
- ⑤ 능력·출시일은 큐레이션 seed 기준(프로바이더 API가 안 줌) — 새 모델은 refresh로 id는 자동, 능력/날짜는 큐레이션 보완.

## 배포
- 커밋만(푸시 안 함). DB(마이그156)는 이미 프로덕션 적용. **푸시 후 라이브 반영.**
