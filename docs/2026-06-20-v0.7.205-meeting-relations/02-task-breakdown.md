# 02-task-breakdown — v0.7.205 (순서: E→B→C/D→A, DC-BIZ 권고)

## T-DB (🟩 DC-DEV-DB) — `supabase/migrations/118_meeting_attendee_uids.sql`
- ADD `meeting_notes.attendee_user_ids uuid[]` (additive, default null).
- GIN 인덱스 `idx_meeting_notes_attendee_uids` (partial: where deleted_at is null).
- 주석: 외부인=attendees만, 내부인=attendees+attendee_user_ids. 기존 데이터 변형 0.
- 적용: `scripts/migrate.sh 118_meeting_attendee_uids.sql` (DB 연결문자열은 메모리 project_db_connection).
- verify: `migrate.sh --status`에 118 등재 + `\d meeting_notes` 컬럼 존재.

## T-BE (🟩 DC-DEV-BE) — 의존: T-DB
파일별:
1. **`lib/meeting/match-attendees.ts`** (신규, 순수): `normalizeName(s)`(trim·공백압축·소문자·접미사 님/씨 제거), `matchAttendees(names: string[], people: {id:string; name:string}[]): { matched: {id:string; name:string}[]; unmatched: string[] }`. + 단위테스트 `match-attendees.test.ts`(동명이인/외부인/공백/접미사/빈배열).
2. **`lib/meeting/parse-helpers.ts`**: `mapAttendees(raw): AttendeeCandidate[]`({name, confidence, source_quote}, 기존 필터 규칙). + parse-helpers 테스트에 케이스 추가.
3. **`lib/gemini-meeting.ts`**: `MeetingItems`에 `attendees: AttendeeCandidate[]` 추가. 프롬프트에 "attendees: 회의 참석자 이름" 추출 규칙 추가(source_quote 강제). `extractMeetingItems` 반환에 `attendees: mapAttendees(parsed.attendees)`.
4. **`app/api/ai/meeting-extract/route.ts`**: 응답 data에 `attendees` 포함.
5. **`meeting-notes/actions.ts`**:
   - createSchema/updateSchema: `attendee_user_ids: z.array(z.string().uuid()).max(200).nullish()`, `department_id: z.string().uuid().nullish()`.
   - create/update payload: attendee_user_ids, department_id 반영.
   - `getMeetingNote` select+반환: `attendee_user_ids`, `department_id` 추가(상세에서 칩 복원).
   - **신규** `syncMeetingCalendar(noteId)`: 01-architecture §B 멱등 upsert. create/update 성공 후 호출.
   - `deleteMeetingNote`: 연결 `calendar_events(link_kind='meeting', link_id)` 삭제.
   - **신규** `listOrgPeople(): {id,name}[]` — profiles id,name (deleted_at null, role!=api_user) 정렬.
   - **신규** `getMeetingDerivedLogs(noteId): DailyLog[]` — daily_logs where meeting_note_id=noteId, 본인, 최신순.
   - **신규** `getMeetingDepartments(): {id,name}[]` — org_nodes type='department' (부서 선택용). (기존 유틸 있으면 재사용)

## T-FE (🟩 DC-DEV-FE) — 의존: T-BE
1. **`MeetingEditor.tsx`**: 참석자 `<input>`·attendees 상태 제거. 부서 선택 드롭다운 추가(`getMeetingDepartments`, input-field/label). `MeetingNoteDraft`에서 attendees 제거, department_id 추가. create/edit 페이지·MeetingDetailClient의 initial 동기화.
2. **`AttendeesPanel.tsx`** (신규, 회의노트 상세): 칩 UI(내부=조직원/외부=텍스트), 조직원 추가 드롭다운(listOrgPeople), 외부 텍스트 추가, 삭제, 저장(updateMeetingNote). props: noteId, 초기 attendees/attendee_user_ids, people. input-field/label/NbButton/badge 토큰.
3. **`MeetingAiPanel.tsx`**: 추출 결과에 `attendees` 후보 그룹 추가(matchAttendees로 내부/외부 분류 표시). "참석자에 반영" → AttendeesPanel로 합류(부모 상태 콜백 or router.refresh 후 재조회). 자동확정 금지.
4. **`MeetingDetailClient.tsx`**: AttendeesPanel 마운트(메타 영역의 정적 attendees 표기를 패널로 대체). people 주입(서버 컴포넌트 [id]/page.tsx에서 listOrgPeople 호출해 전달).
5. **`calendar/DayDetailPanel.tsx`**: 일정 타일에 `ev.link_kind==='meeting'` → "회의" 배지 + 타일 클릭 `router.push('/daily?meeting='+ev.link_id)`. (삭제 버튼과 클릭 영역 분리: stopPropagation 유지)
6. **`daily/page.tsx`**: (a) `?meeting=` 컨텍스트 모드 배너+파생로그 목록(getMeetingDerivedLogs, LogList 재사용). (b) 로그 카드 "↗ 회의노트" 칩(meeting_note_id) → `/meeting-notes/<id>`. `meetingMap`/직접 log 필드 사용. `types/database` DailyLog에 meeting_note_id 확인·추가, `/api/daily/logs` select 컬럼 포함.

## T-TEST (🟥 DC-QA + Playwright) — 의존: T-FE
03-test-strategy 참조.

## 버전/커밋
- 루트 `package.json` + `apps/web/package.json` → 0.7.205, CLAUDE.md·AGENTS.md 버전 라인.
- 커밋: `v0.7.205: 회의노트 릴레이션 허브 — 참석자 AI추출+조직원매칭·캘린더 멱등연동·캘린더→업무→회의노트 순회 claude` (사용자 승인 후, push 금지)
