# 03-test-strategy — v0.7.205

## 단위 (node:test — apps/web, package.json test 목록에 신규 파일 append 필수)
- `lib/meeting/match-attendees.test.ts`:
  - 정확 일치 매칭 / 동명이인(첫 일치) / 외부인=unmatched / 공백·대소문자 정규화 / 직급접미사(님·씨) 제거 후 일치 / 빈 입력 / people 빈 배열.
- `lib/meeting/parse-helpers.test.ts` (기존): `mapAttendees` — source_quote 없으면 제외 / confidence<0.7 제외 / title(name) 공백 제외 / 정상 통과.

## 통합 (서버 액션 — 멱등성 핵심)
- `syncMeetingCalendar`: 동일 noteId 2회 호출 → calendar_events 1건만(중복 0). title/meeting_at 변경 후 재호출 → 기존 1건 update(추가 안 됨). 소프트삭제 → 연결 이벤트 0건.
- `getMeetingDerivedLogs`: meeting_note_id 매칭 로그만, 타 유저 행 제외(RLS).
- 테스트 격리: throwaway 계정 / is_test성 데이터. **운영 실데이터 오염 금지**(메모리 feedback_test_isolation).

## E2E (Playwright — 내가 직접, UI 단위 + 변칙)
throwaway 계정으로 실화면 검증. 정상 흐름 + 변칙:

### 정상 순회
1. 회의노트 작성(제목+본문) → 저장 → **캘린더에 회의 일정 1건 자동 생성** 확인(/calendar 해당일).
2. 회의노트 상세 "AI 분석" → 참석자/업무/일정 후보 표출 → 참석자 일부 반영 + 업무 후보 반영(daily_logs 생성).
3. 캘린더에서 회의 일정 클릭 → `/daily?meeting=` 진입, 배너+파생 업무 표시.
4. 파생 업무 카드의 "↗ 회의노트" 칩 클릭 → 회의노트 상세 복귀(순회 완성).
5. AttendeesPanel: 조직원 추가/외부인 텍스트 추가/삭제 → 저장 → 새로고침 후 칩 유지(내부=조직원, 외부=텍스트).

### 변칙 (타이트)
- V1 **외부인만**: AI가 조직원 아닌 이름만 추출 → 전부 unmatched(텍스트 칩), uuid 0.
- V2 **매칭 실패/추출 0**: 본문에 이름 없음 → 참석자 빈 상태, 사용자가 수동 추가 가능.
- V3 **회의일시 미입력**: meeting_at 없이 저장 → 캘린더 자동기록 start_at=작성시각으로 생성.
- V4 **수정 멱등**: 회의노트 제목 수정·재저장 N회 → 캘린더 일정 여전히 1건(중복 없음), 제목 동기화.
- V5 **소프트삭제 정리**: 회의노트 삭제 → 캘린더 회의 일정 사라짐, 파생 daily_logs의 meeting_note_id=NULL(ON DELETE SET NULL) → "↗ 회의노트" 칩 사라짐(고아 링크 없음).
- V6 **동명이인**: 같은 이름 조직원 2명 → 매칭 시 경고/첫 일치, 잘못된 자동확정 없음.
- V7 **권한 격리**: 타 유저 회의노트/파생로그 접근 불가(RLS).
- V8 **반응형**: 320/768/1024에서 AttendeesPanel 칩·드롭다운·daily 배너 깨짐 없음(가로 스크롤 0).

### 검증 도구
- `pnpm exec tsc --noEmit` / `pnpm lint` / `pnpm design:check` / `pnpm test`(신규 단위 포함) 전부 green.
- Playwright는 기본 플래그 상태의 실제 렌더 경로에서 확인(스냅샷+스크린샷).
