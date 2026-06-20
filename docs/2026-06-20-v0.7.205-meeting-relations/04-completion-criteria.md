# 04-completion-criteria — v0.7.205 (전 항목 ✅ 전까지 완료 선언 금지)

## 기능 완료 기준
- [ ] C-1 migration 118 적용됨(`--status` 등재), `meeting_notes.attendee_user_ids` 존재.
- [ ] C-2 MeetingEditor에서 참석자 자유텍스트 입력칸 제거됨. 부서 선택 드롭다운 추가됨.
- [ ] C-3 `lib/meeting/match-attendees.ts` SSOT 존재 + 모든 호출처가 import(복붙 0).
- [ ] C-4 AI 분석이 참석자 후보를 추출하고, 조직원/외부인으로 분류 제시(자동확정 X).
- [ ] C-5 AttendeesPanel: 조직원 추가/외부인 텍스트 추가/삭제/저장, 새로고침 후 유지(내부=uuid, 외부=text).
- [ ] C-6 회의노트 저장 시 캘린더에 회의 일정 자동 1건(멱등 — 수정 N회에도 1건, 제목/시각 동기화).
- [ ] C-7 회의일시 미입력 시 작성시각 기준 자동기록.
- [ ] C-8 회의노트 소프트삭제 시 연결 캘린더 일정 제거 + 파생 로그 칩 사라짐(고아 0).
- [ ] C-9 캘린더 회의 일정 클릭 → `/daily?meeting=` 진입(배너+파생 업무).
- [ ] C-10 파생 업무 카드 "↗ 회의노트" 칩 → 회의노트 상세 이동(역참조).

## 품질 게이트 (자동화)
- [ ] G-1 `pnpm exec tsc --noEmit` 0 에러.
- [ ] G-2 `pnpm lint` 통과.
- [ ] G-3 `pnpm design:check` 통과(토큰/하드코딩).
- [ ] G-4 `pnpm test` 통과(신규 단위 포함 — package.json test 목록에 append됨).
- [ ] G-5 `pnpm build`(next build) 성공 — React18 실빌드 검증(메모리 feedback_react18_build_verify).

## E2E / 변칙 (Playwright, 직접)
- [ ] E-1 정상 순회 1~5 통과(캘린더 자동생성·AI후보·calendar→daily→meeting 순회·참석자 저장유지).
- [ ] E-2 변칙 V1~V8 전부 통과(외부인만/추출0/일시없음/수정멱등/삭제정리/동명이인/권한격리/반응형).

## 리뷰
- [ ] R-1 🟥 DC-REV APPROVED(아키텍처·SSOT·재사용·회귀).
- [ ] R-2 🟥 DC-QA PASS(완료기준 전 항목 실측).

## 버전/배포
- [ ] V-1 루트+apps/web package.json = 0.7.205, CLAUDE.md·AGENTS.md 버전 라인.
- [ ] V-2 커밋(`v0.7.205: ... claude`) — **push 금지**(메모리 feedback_no_push).
