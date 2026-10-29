# PLAN newAX: 회의노트와 CRM 미팅을 한 기록으로 합친다
플랜 ID: P0174
플랜 버전: v0.1.3
상태: 진행중
지시: ins_0417
목표 버전: v0.11.94
푸시: 모음
작성: 2026-10-27
시작 커밋: e7f76ebd

## 목표
- 회의 기록은 회의노트 하나다, CRM 미팅 화면은 같은 노트에 회사 딜 장소를 더 붙여 보여 줄 뿐이고 내용을 복사해 두지 않는다
- 공개 범위는 나만 보기와 팀 공개 둘이다, 팀 공개는 조직도 기준으로 작성자의 팀과 그 상위 팀장이 본다 (private.my_readable_dept_ids)
- 노트를 지우면 CRM 쪽도 휴지통으로 가고, 휴지통에서 되살리면 둘 다 돌아온다

## 범위 밖
- CRM 녹음 전사 표(crm_meeting_recording, crm_transcript_segment) 의 물리 삭제, 되돌릴 수 없는 데이터 삭제라 이 플랜에서는 쓰지 않게만 하고 표 삭제는 사용자 확인 뒤 별도로 함
- 관리자가 모든 회의노트를 읽는 기존 RLS 갈래, 이번 지시가 다루지 않은 기존 권한이라 그대로 둠

## 완료 정의
- pnpm typecheck, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 전부 lib/terms 또는 기존 문구 상수 사용
- 설정값은 env 추가 없이 DB 저장 + UI 관리 (해당 시)
- 실브라우저(ego-browser)로 노트 작성 → 팀 공개 → CRM 목록에 같은 내용 → 노트 수정이 CRM 에 바로 보임 → 노트 삭제 → 휴지통 복원까지 확인

## 참조
- 조사 결과 (이 대화, 2026-10-27): 원본은 노트, CRM 은 스냅샷 사본, 공개 판정은 lib/meeting/share-state.ts
- 실측 2026-10-27: crm_meeting 44건(지움 22), noteId 없는 것 13건, meeting_notes 77건(살아 있음 43), visibility crm 39건, department_id 빈 노트 54건, 작성자 5명, 워크스페이스 2개
- 조직 권한 함수 supabase/migrations/046_org_closure_permissions.sql (my_readable_dept_ids, is_executive)
- 화면 말 lib/terms/entity.ts

## 항목

### I01 회의노트 공개 범위를 조직도 기준 팀 공개로 바꾼다 (DB)
상태: 통과
모드: 중량
범위: supabase/migrations/321_meeting_note_team_visibility.sql (신규)
감사 기준:
- 보안: meeting_notes SELECT 정책이 본인, 관리자, (visibility='team' 이고 meeting_note_team_readable(user_id)) 셋만 허용하고 TO public USING (true) 가 없다, 판정 함수는 SECURITY DEFINER + search_path 고정 + anon 실행권 없음
- 보안: INSERT UPDATE DELETE 정책은 본인만 그대로다, 마이그 파일 안에 해당 정책을 건드리는 문장이 없다
- CHECK 가 ('private','team') 이고 기존 'crm' 행은 'team' 으로 옮겨진다, 팀 판정은 사람이 고르는 department_id 가 아니라 작성자의 조직 노드(소속 부서와 맡은 노드)로 한다
- 마이그레이션을 롤백 트랜잭션으로 먼저 돌려 오류 0, 적용 뒤 일반 사용자 권한으로 /meeting-notes 목록이 비지 않는다 (마이그 220 사고 재발 방지)
의존: 없음

### I01a 노트가 바뀌면 CRM 미팅의 제목 일시 요약을 DB 가 따라 적는다
상태: 통과
모드: 중량
범위: supabase/migrations/323_meeting_note_mirror_to_crm.sql (신규)
감사 기준:
- 보안: 트리거 함수는 SECURITY DEFINER + search_path 고정 + anon 실행권 없음, 요약은 visibility='team' 일 때만 적고 나만 보기면 null
- 일반 사용자 역할로 자기 노트 제목을 고치면 같은 트랜잭션에서 crm_meeting.title 이 같은 값이 된다 (롤백 시험)
- 적용 전 실측으로 제목이나 일시가 갈린 미팅 수를 주석에 적고, 한 번 맞추기가 사람이 쓴 값을 잃지 않음을 확인
- 되돌리는 법이 주석에 있다
의존: I01

### I02 공개 상태를 두 가지로 줄인다 (나만 보기, 팀 공개)
상태: 통과
모드: 경량
범위: apps/web/lib/meeting/note-visibility.ts, apps/web/lib/meeting/share-state.ts, apps/web/lib/meeting/share-state.test.ts, apps/web/components/meeting/NoteVisibilitySwitch.tsx, apps/web/lib/crm/services/meeting-publish.ts (부르는 자리만), apps/web/app/(member)/meeting-notes/CrmPublishCard.tsx, apps/web/app/(member)/meeting-notes/crm-share.module.css, apps/web/app/(member)/meeting-notes/MeetingDetailClient.tsx, apps/web/app/(crm)/crm/meetings/[id]/MeetingDetail.tsx, apps/web/components/meeting/MeetingWorkbench.tsx, apps/web/lib/meeting/digest-progress.test.ts
감사 기준:
- 보안: 해당 없음 판정 근거를 적는다 (판정은 DB 정책이 하고 이 항목은 값과 말만 바꾼다)
- NOTE_VISIBILITY 값이 private, team 이고 마이그 321 CHECK 와 같다 (시험이 둘을 대조)
- 'RECORD_ONLY' 문자열이 lib components app 에서 0건
- 팀 공개 안내 문구가 「내 팀과 상위 팀장이 볼 수 있어요」 뜻이고 「영업」 「워크스페이스」를 말하지 않는다
의존: I01

### I03 원본 없는 CRM 미팅 13건에 노트를 만든다
상태: 대기
모드: 중량
범위: supabase/migrations/322_crm_meeting_backfill_note.sql (신규)
감사 기준:
- 보안: 새로 만드는 노트의 user_id 는 그 미팅의 createdById 이고 visibility 는 team, 남의 이름으로 노트가 생기지 않는다
- 적용 뒤 crm_meeting 에서 noteId 가 null 인 행 0건 (지운 것 포함)
- 새 노트의 summary 는 미팅 summaryMd, transcript 는 그 미팅 전사 구간을 시간순으로 이은 글이다
- 되돌리는 법(만든 노트 id 목록으로 지우고 noteId 를 null 로)이 마이그 주석에 있다
의존: I01

### I04 CRM 미팅이 내용을 노트에서 읽는다 (목록, 상세)
상태: 대기
모드: 중량
범위: apps/web/lib/crm/services/meeting.ts, apps/web/lib/crm/services/meeting-note-read.ts (신규), apps/web/lib/crm/services/meeting-note-read.test.ts (신규), apps/web/app/api/crm/meetings/route.ts, apps/web/app/api/crm/meetings/[id]/route.ts
감사 기준:
- 보안: CRM 목록과 상세가 읽는 사람의 Supabase 세션(RLS)으로 볼 수 있는 노트의 미팅만 돌려준다, 볼 수 없는 노트의 미팅 상세는 404
- 제목 일시 요약 참석자가 노트 값이다, 노트를 고치면 CRM 상세가 「반영하기」 없이 바로 바뀐다
- pnpm test 에서 meeting-note-read 시험 통과 (남의 비공개 노트 미팅이 목록에 안 나옴)
의존: I01, I03

### I05 노트에서 CRM 으로 복사하던 길을 걷어 낸다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/services/meeting-publish.ts, apps/web/lib/crm/services/meeting-publish.test.ts, apps/web/lib/crm/jobs/finish-deps.ts
감사 기준:
- 보안: 공개 범위를 바꾸는 사람이 노트 주인인지 확인한다, AI 추출이 읽는 노트는 주인이거나 팀 공개일 때만
- publishFromNote 가 summaryMd 와 note-snapshot 녹음을 더 쓰지 않고 연결 행만 만든다
- resyncFromNote, isNoteNewerThanSnapshot 을 부르는 곳 0건
- setNoteShareState 가 미팅을 휴지통에 넣지 않고 visibility 를 바꾸며, 팀 공개나 회사 딜을 고르면 연결 행이 없을 때만 만든다
- AI 추출은 매번 노트의 지금 내용으로 근거 구간을 다시 뜬다 (옛 사본을 읽지 않는다)
의존: I04

### I06 지우기와 되살리기를 노트와 CRM 이 함께 한다
상태: 대기
모드: 경량
범위: apps/web/app/(member)/meeting-notes/actions.ts, apps/web/app/api/meeting-notes/[id]/route.ts, apps/web/lib/crm/services/meeting.ts, apps/web/lib/meeting/note-trash.ts (신규), apps/web/lib/meeting/note-trash.test.ts (신규)
감사 기준:
- 보안: 노트 삭제 복원은 본인만, CRM 삭제 복원은 그 미팅의 원본 노트 주인이거나 CRM ADMIN 이상
- 노트를 지우면 연결된 crm_meeting.deletedAt 이 채워지고, CRM 휴지통에서 복원하면 노트 deleted_at 도 비워진다
- 회의노트 화면에 휴지통 보기와 복원이 있다
의존: I05

### I07 CRM 미팅 전사 붙여넣기가 노트 전사로 간다
상태: 대기
모드: 경량
범위: apps/web/app/api/crm/meetings/[id]/transcript/route.ts, apps/web/app/api/meeting-notes/[id]/transcript/route.ts, apps/web/lib/meeting/paste-into-note.ts (신규)
감사 기준:
- 보안: 전사를 쓰는 사람이 원본 노트 주인인지 확인한다, 아니면 403
- CRM 에서 붙인 전사가 /meeting-notes/{id} 전사 탭에 같은 글로 보인다
- 사람이 넣는 전사가 crm_meeting_recording 에 가는 코드 0건 (AI 추출 근거 구간만 남는다)
의존: I05

### I08 화면 정리 (이름 통일, 반영하기 단추와 올리기 모달 제거)
상태: 대기
모드: 경량
범위: apps/web/lib/terms/entity.ts, apps/web/lib/crm/nav/groups.ts, apps/web/app/(crm)/crm/meetings/[id]/MeetingDetail.tsx, apps/web/app/(crm)/crm/meetings/MeetingsClient.tsx, apps/web/app/(member)/meeting-notes/MeetingDetailClient.tsx
감사 기준:
- 보안: 해당 없음 판정 근거를 적는다 (화면 말과 단추만, 권한 판정은 서버)
- CRM 탭과 화면 제목이 「회의노트」, 사이드바 라벨과 도착 화면 제목이 같은 말
- 「반영하기」 「영업 CRM에 올리기」 단추 0건, 노트 화면에서 회사 딜을 바로 고른다
- pnpm test 화면 가드 (product-copy, glossary) 통과
의존: I05, I06

### I09 CLI 정의와 대응표 갱신, 안 쓰는 코드 지우기
상태: 대기
모드: 경량
범위: apps/web/lib/actions/defs/crm.ts, apps/web/lib/actions/defs/work.ts, apps/web/lib/actions/generated, docs/cli/02-기능대응표.md, apps/web/app/(crm)/crm/meetings/MeetingFormModal.tsx
감사 기준:
- 보안: 해당 없음 판정 근거를 적는다 (창구를 줄이거나 동작만 바꾼다)
- pnpm test 의 parity, openapi-shape, openapi-inputs 시험 통과
- 대응표에 바뀐 명령(from-note, resync, unpublish)의 새 동작이 적혀 있다
- MeetingFormModal.tsx 없음
의존: I05, I06, I07

### I10 실브라우저 확인과 업데이트 내역
상태: 대기
모드: 경량
범위: apps/web/lib/changelog/entries.ts
감사 기준:
- 보안: 해당 없음 판정 근거를 적는다
- ego-browser 로 완료 정의의 흐름을 끝까지 돌리고 각 단계 결과를 적는다
- 시험 계정(다른 팀)으로 팀 공개 노트가 안 보이고, 같은 팀 계정으로 보인다
- entries.ts 맨 위에 v0.11.94 블록
의존: I08, I09

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-27) 최초 작성 (ins_0417)
- v0.1.2 (2026-10-29) I01a 추가, crm_meeting.summaryMd 를 읽는 곳이 일곱이고 예약 작업은 RLS 로 노트를 못 읽어 칸을 지우지 않고 트리거로 따라 적게 함, I05 I07 기준 조정 (AI 근거 구간은 추출 때마다 노트에서 다시 뜸)
- v0.1.1 (2026-10-29) I01 기준 수정, department_id 는 사람이 고르는 칸이라 빈 칸 54건이 아무에게도 안 보이고 다른 부서로 공개하는 길이 생김, 작성자의 조직 노드로 판정
- v0.1.2 (2026-10-29) I01a 추가, crm_meeting.summaryMd 를 읽는 곳이 일곱이고 예약 작업은 RLS 로 노트를 못 읽어 칸을 지우지 않고 트리거로 따라 적게 함, I05 I07 기준 조정 (AI 근거 구간은 추출 때마다 노트에서 다시 뜸)
- v0.1.1 (2026-10-29) I01 팀 판정을 작성자 조직 노드로 (audit:I01)
- v0.1.2 (2026-10-29) I01a 미러 트리거 추가, I05 I07 기준 조정 (audit:I05)
- v0.1.3 (2026-10-29) I02 범위에 부르는 자리 일곱 파일 추가, 상태 넷을 둘로 줄이면 타입이 그 자리까지 안 닫힘 (audit:I02)
- v0.1.3 (2026-10-29) I02 범위에 부르는 자리 추가, 상태를 둘로 줄이면 타입이 부르는 곳까지 안 닫힘 (audit:I02)
