# FAST PATH Summary — 주간보고 지연추적 Playwright 적대적 재검증

작업: Playwright 실브라우저 + 실DB로 변칙/경계 조건까지 까다롭게 재검증, 발견된 모달 충돌 버그 수정
대상:
- (검증) 실DB 적대적 매트릭스 7/7, Playwright 풀 라이프사이클 9/9
- (수정) `lib/changelog/entries.ts` — CHANGELOG_SEEN_KEY export + isChangelogPending() SSOT 헬퍼
- (수정) `components/ui/WeeklyReminderModal.tsx` — changelog 모달과 동시 노출 시 양보(충돌 회피)
- (수정) `components/ui/MobileShell.tsx` — 판정식을 isChangelogPending로 일원화(중복 제거)

이유: 적대적 Playwright 검증에서 **신규/미확인업데이트 유저에게 첫접속 ChangelogModal과 주간보고 작성안내 모달이 동일 z-index로 스택되어 클릭 충돌**하는 실 UX 버그 발견. 리마인더가 changelog에 양보하고, changelog 닫은 뒤 다음 이동에 정상 노출되도록 수정.

영향: 모달 노출 순서만 조정(데이터/판정 로직 무변경). 기존 changelog 동작 동일성 보존(동일 키·헬퍼).

검증:
- 실DB 적대적 7시나리오(정시/지연(토)/지연(취합후수정)/최종지연/진행중(삭제후)/정시(재작성)/진행중(무활동)) 전부 기대=실제 일치, seed 무오염 cleanup
- Playwright 실로그인 9/9: 로그인·레이아웃 5xx무·페이지렌더·충돌양보·changelog ESC·리마인더 노출·ESC억제·재노출차단
- 단위 376/376, tsc/lint/design:check/build green, 🟥 DC-REV PASS(79.3, 임계충족)

후속(비차단): 모달 N개 대비 전역 modal-stack 추상화, weekly_reminder_seen_* 키 누적 정리 hook.
