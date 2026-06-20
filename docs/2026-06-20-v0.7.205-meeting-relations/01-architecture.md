# 01-architecture — 회의노트 릴레이션 허브 (v0.7.205)

## 릴레이션 그래프 (목표)
```
profiles/org_nodes ──(attendee_user_ids uuid[])── meeting_notes ──(link_id)── calendar_events(link_kind='meeting')
                              (attendees text[] = 외부인)        │
                                                                 └─(meeting_note_id)── daily_logs (파생 업무)
```

## SSOT 원칙
- **이름→조직원 매칭**: `lib/meeting/match-attendees.ts` (순수 함수) — 모든 호출처 재사용. Supabase 비의존(테스트 가능).
- **AI 추출 매핑/필터**: `lib/meeting/parse-helpers.ts`에 `mapAttendees` 추가(기존 mapTasks 패턴 동일).
- **캘린더 동기화**: `meeting-notes/actions.ts`의 `syncMeetingCalendar(noteId)` 1곳 — create/update가 호출. 멱등 upsert.

## 데이터 모델 변경 (additive — migration 118)
- `meeting_notes.attendee_user_ids uuid[]` 추가. (기존 `attendees text[]` = 전체 표시 이름; `attendee_user_ids` = 매칭된 내부 조직원 uuid)
  - 외부인 = `attendees`에만 존재(uuid 없음). 내부인 = `attendees`에 이름 + `attendee_user_ids`에 uuid 동시 존재.
  - 이미 존재: `daily_logs.meeting_note_id`, `calendar_events.link_kind='meeting'`. → 추가 마이그레이션 불필요.
- GIN 인덱스: `idx_meeting_notes_attendee_uids on meeting_notes using gin (attendee_user_ids)` (향후 "내가 참석한 회의" 필터 대비, 활성행 partial).

## A. 참석자 AI 추출 + 조직원 매칭
- **추출**: `extractMeetingItems`에 `attendees: string[]` 추가(프롬프트에 "참석자 이름" 항목 추가, source_quote 강제·confidence≥0.7 필터 동일). 라우트 `meeting-extract`가 통과.
- **매칭**: `matchAttendees(names, people)` → `{ matched: {id,name}[], unmatched: string[] }`. people = `listOrgPeople()`(profiles id,name; deleted_at null). 매칭 규칙: 공백/대소문자 정규화 후 정확 일치(동명이인은 첫 일치 + 경고 표시). 직급 접미사(님/씨)는 제거 후 비교.
- **UI**: 회의노트 상세에 `AttendeesPanel` 신설(또는 MeetingDetailClient 내 섹션). 칩 표시: 내부=조직원 칩(아바타/이름), 외부=텍스트 칩. 조작: ① 조직원 추가(검색 드롭다운=listOrgPeople) ② 외부인 텍스트 추가 ③ 삭제. 저장=`updateMeetingNote({ attendees, attendee_user_ids })`.
- **AI 후보**: MeetingAiPanel "AI 분석" 시 참석자 후보도 받아 → matchAttendees로 내부/외부 분류해 후보 칩 제시 → 사용자가 "참석자에 반영" 시 AttendeesPanel 상태로 합류. **자동 확정 금지.**
- MeetingEditor의 자유텍스트 참석자 `<input>` **제거**. (참석자 관리는 상세 화면에서)

## B. meeting → calendar 멱등 자동기록
- `syncMeetingCalendar(noteId)`:
  1. 노트(title, meeting_at, created_at, deleted_at) 조회(본인).
  2. `start_at = meeting_at ?? created_at`. all_day=false.
  3. 기존 `calendar_events where link_kind='meeting' and link_id=noteId and user_id=me` 1건 조회.
  4. 있으면 `update(title, start_at)`; 없으면 `insert(...link_kind='meeting', link_id=noteId, source='user')`. (중복 절대 금지)
  5. `deleted_at` 있으면(소프트삭제) 연결 이벤트 삭제.
- `createMeetingNote`·`updateMeetingNote` 성공 후 호출. `deleteMeetingNote`는 연결 이벤트 삭제. best-effort(캘린더 실패가 노트 저장을 막지 않음), `revalidatePath('/calendar')`.

## C. calendar → task 진입 ("업무로 직접")
- `DayDetailPanel`의 일정 타일: `ev.link_kind==='meeting'`이면 "회의" 배지 + 타일 클릭 시 `router.push('/daily?meeting='+ev.link_id)`. (기존 'daily' 배지 분기 옆에 추가)
- `/daily`에 **meeting 컨텍스트 모드**(contained, additive): `?meeting=<id>` 존재 시 상단 배너("📋 '<제목>' 회의에서 생성된 업무 N건" + 회의노트 보기 링크) + 파생 로그 목록(기존 LogList 재사용). 데이터=`getMeetingDerivedLogs(noteId)`(daily_logs where meeting_note_id=noteId, 본인). 파생 0건이면 배너에 "아직 생성된 업무 없음 → 회의노트 보기". 날짜 타임라인 모드와 독립(회귀 0).

## D. task → meeting 역참조
- `/daily` 로그 카드: `log.meeting_note_id` 존재 시 "↗ 회의노트" 칩(기존 `linked`(부서업무)·`linkedCal` 칩 패턴 동일) → `/meeting-notes/<id>`. `DailyLog` 타입에 `meeting_note_id` 포함 확인, `/api/daily/logs` select에 컬럼 포함.

## E. 부서 선택 UI (FR-5)
- MeetingEditor에 부서 선택(`department_id`) 드롭다운 추가(org_nodes type='department'). `createMeetingNote/updateMeetingNote` 스키마에 `department_id` 추가.

## 보안/RLS
- 신규 컬럼은 기존 `meeting_notes` RLS(본인 OR admin) 승계. `attendee_user_ids`는 표시·필터용일 뿐 권한 부여 아님.
- 모든 server action: auth.uid 검증 + 본인 user_id 조건(이중 방어). zod 재검증. uuid[] 입력 검증.

## 실제 렌더 경로
- meeting-notes·calendar·daily 모두 feature flag 분기 없음 — 단일 경로. 수정이 곧 실화면.
