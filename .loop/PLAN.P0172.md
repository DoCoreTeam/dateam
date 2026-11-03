# PLAN newAX: 녹음 단추가 미팅 시작과 같은 동작을 한다
플랜 ID: P0172
플랜 버전: v0.1.8
상태: 진행중
지시: ins_0391
목표 버전: v0.11.100
푸시: 모음
작성: 2026-10-26
시작 커밋: 740feb2d

## 목표
- 어디서 「녹음 시작」을 눌러도 미팅 시작과 같은 길로 미팅과 회의노트가 생기고, 작업대가 회의 기록 편집기를 연 채로 녹음이 바로 돈다
- 딜과 회사 화면에서 시작하면 그 딜과 회사가 미팅에 붙는다
- 연결이 없을 때도 같은 자리에서 녹음과 함께 기록을 적을 수 있고, 연결되면 그 기록이 회의노트 본문으로 올라간다

## 범위 밖
- 녹음 제공자(recording-context) 내부 구조 변경, 전사 파이프라인
- 오프라인에서 서버 주소로 화면 이동 (없는 주소라 화면이 죽음, P0091 함정)
- 미팅 시작 단추가 녹음을 자동으로 켜는 것 (녹음 단추만 켬)

## 완료 정의
- pnpm typecheck, pnpm lint, pnpm test, pnpm build 통과
- 녹음 입구 전부가 lib/meeting/start-flow.ts 한 길을 지남 (소스 가드)
- 실브라우저 열 단계: 헤더 녹음 시작, 미팅 하나와 노트 하나, 편집기 열림, 한 줄 저장, 멈춤 뒤 기록 유지, 딜 화면 시작 시 딜 연결, 오프라인 시작 시 같은 자리 기록
- 사용자 노출 문자열은 lib/terms 경유, 전각 대시와 한자 없음
- 보안 다섯 셈 전부 0

## 참조
- LOOP.md 9절 F-N (F-8 배선, F-10 실브라우저)
- lib/crm/ui/start-meeting.ts, lib/meeting/begin-recording.ts, lib/meeting/start-guard.ts
- lib/offline/local-meeting.ts, lib/offline/reconcile.ts (P0091, P0171)

## 항목

### I01 시작 한 길 lib/meeting/start-flow.ts
상태: 통과
모드: 경량
범위: apps/web/lib/meeting/start-flow.ts (신규), apps/web/lib/meeting/use-start-meeting.ts (신규), apps/web/lib/meeting/start-flow.test.ts (신규), apps/web/package.json
감사 기준:
- 보안: 새 저장 없음, 새 창구 없음, 기존 POST /api/crm/meetings 와 startMeetingNote 만 부름, 오류는 기존 문구로 내부 구조를 싣지 않음
- node --experimental-strip-types --test lib/meeting/start-flow.test.ts 통과, record 진입은 ?wb=memo 와 자동 녹음 표지를 단 주소, write 진입은 표지 없음, 오프라인은 local 결과
- dealId companyId dateKey 가 만들기 요청 본문으로 그대로 넘어감을 단정
- pnpm test 총 테스트 수 증가, lib/ui/test-registry.test.ts 통과
의존: 없음

### I02 작업대가 자동 녹음 표지를 받아 한 번만 녹음을 켬
상태: 통과
모드: 경량
범위: apps/web/lib/meeting/auto-record.ts (신규), apps/web/lib/meeting/auto-record.test.ts (신규), apps/web/components/meeting/RecordingPanel.tsx, apps/web/package.json
감사 기준:
- 보안: 해당 없음, 주소 표지는 녹음 켜기 여부만 정하고 저장이나 창구가 없음
- auto-record.test.ts 통과, 같은 노트에 두 번 켜지 않음, 다른 녹음이 돌면 안 켬, 표지는 켠 뒤 주소에서 지움
- pnpm typecheck 통과
의존: I01

### I03 녹음 입구 전부를 한 길로 배선
상태: 통과
모드: 경량
범위: apps/web/components/meeting/MeetingStartButton.tsx, apps/web/components/crm/MeetingIntakeBox.tsx, apps/web/components/ui/crm/MeetingPanel.tsx, apps/web/app/(crm)/crm/meetings/MeetingsClient.tsx, apps/web/components/calendar/CalendarContextMenu.tsx, apps/web/components/calendar/DayWorkbench.tsx, apps/web/lib/meeting/start-entry-wiring.test.ts (신규), apps/web/lib/meeting/begin-recording.test.ts, apps/web/lib/crm/services/today-meetings.test.ts, apps/web/lib/meeting/workbench-tab.test.ts, apps/web/lib/meeting/workbench-wiring.test.ts, apps/web/lib/crm/nav/back-link.test.ts, apps/web/lib/meeting/digest-progress.test.ts, apps/web/lib/calendar/calendar-surface.test.ts, apps/web/package.json
감사 기준:
- 보안: 해당 없음, 새 창구와 저장 없음
- start-entry-wiring.test.ts 통과, 녹음 입구 파일 전부가 start-flow 를 import 하고 beginRecording 이나 startMeeting 을 직접 부르지 않음, S6 로 한 입구를 직접 호출로 되돌려 실패 확인
- 딜과 회사 미팅 패널에 녹음 시작이 있고 미팅 시작과 함께 dealId companyId 를 start-flow 로 넘김, 캘린더 두 입구는 dateKey 를 넘김
- pnpm typecheck 통과
의존: I02

### I04 오프라인 녹음 중 같은 자리에서 기록을 적음
상태: 통과
모드: 경량
범위: apps/web/lib/offline/local-memo.ts (신규), apps/web/lib/offline/local-memo.test.ts (신규), apps/web/components/meeting/RecordingBar.tsx, apps/web/components/meeting/recording-bar.module.css, apps/web/lib/terms/action.ts, apps/web/lib/terms/index.ts, apps/web/package.json
감사 기준:
- 보안: 새 저장은 이 기기 localStorage 뿐, 서버 창구 없음, 화면 출력은 React 텍스트로 escape
- local-memo.test.ts 통과, 저장 읽기 지우기 기한 단정
- 로컬 녹음 중 RecordingBar 에 기록 칸이 보이고 적은 글이 새로고침 뒤 남음 (실브라우저 I06 에서 확인)
- pnpm typecheck 통과
의존: I03

### I05 연결되면 기기에 적은 기록이 회의노트 본문으로 올라감
상태: 통과
모드: 경량
범위: apps/web/lib/offline/reconcile.ts, apps/web/lib/offline/reconcile.test.ts, apps/web/lib/offline/local-memo.ts
감사 기준:
- 보안: 기존 인증된 노트 저장 창구만 씀, 글은 escape 뒤 HTML 로 조립 (S4)
- reconcile.test.ts 통과, 기록이 있으면 회의를 만든 뒤 본문을 올리고 성공해야 기록을 지움, 실패하면 남김
- 같은 회의를 두 번 만들지 않는 기존 단정이 그대로 초록
의존: I04

### I05a 같은 녹음 구간을 한 번만 올린다
상태: 통과
모드: 경량
범위: apps/web/lib/offline/sync-parts.ts, apps/web/lib/offline/offline.test.ts
감사 기준:
- 보안: 기존 인증된 녹음 올리기 창구만 씀, 새 창구 없음
- 같은 회의 같은 구간을 동시에 세 번 올려도 fetch 가 한 번만 나감 (offline.test.ts 의 동작 단정)
- 실브라우저에서 녹음을 끝냈을 때 recordings POST 가 구간당 한 번이고 「올리지 못함」 띠가 안 뜸
의존: I05

### I06 실브라우저 열 단계 확인
상태: 통과
모드: 경량
범위: .loop/PLAN.P0172.md, apps/web/components/meeting/RecordingPanel.tsx
감사 기준:
- 보안: 시험 데이터는 id 로 지우고 시험 계정은 정리 상태로 돌림
- 헤더 녹음 시작 뒤 미팅 1건 노트 1건, 작업대 편집기 열림, 한 줄 적어 저장, 멈춤 뒤 기록 유지
- 딜 화면에서 시작한 미팅에 딜 id 가 붙음
- 오프라인 시작 시 같은 자리에서 기록 칸이 열림, 마이크를 못 돌렸으면 못 돌렸다고 적음
의존: I05a

### I07 업데이트 내역
상태: 통과
모드: 경량
범위: apps/web/lib/changelog/entries.ts
감사 기준:
- 보안: 해당 없음, 문구 추가만
- entries.ts 맨 위에 플랜 목표 버전(v0.11.98) 블록, version-rule.test.ts 와 policy-sync.test.ts 통과
- 전각 대시와 한자 0건
의존: I06

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-26) 최초 작성 (ins_0391)
- v0.1.1 (2026-10-26) I01 범위에 화면 쪽 훅 use-start-meeting.ts 추가, 입구가 라우터와 녹음 제공자를 한 자리에서 쓰게 (audit:I01)
- v0.1.2 (2026-10-26) I03 범위에 입구 파일을 읽는 기존 소스 가드 여섯과 package.json 추가, 오프라인 분기가 훅으로 옮겨 가므로 가드가 새 자리를 봐야 함 (audit:I02)
- v0.1.3 (2026-10-26) I03 범위에 캘린더 미팅 시작 두 입구 추가, 미팅 시작 입구도 같은 한 길을 지나게 (audit:I03)
- v0.1.4 (2026-10-26) I03 범위에 DayWorkbench 를 읽는 calendar-surface 가드 추가 (audit:I03)
- v0.1.5 (2026-10-26) I04 범위에 녹음 바 CSS 모듈과 용어 묶음 내보내기 추가 (audit:I04)
- v0.1.6 (2026-10-26) I06 범위에 RecordingPanel 추가, 실브라우저에서 자동 녹음 표지가 주소에 남는 것을 찾아 replaceState 상태 인자를 null 로 고침 (audit:I06)
- v0.1.7 (2026-11-03) I05a 삽입, 실브라우저에서 녹음을 끝내자 같은 구간 0 이 세 번 동시에 올라가 둘이 502 와 「올리지 못함」 띠를 내고 드라이브에 주인 없는 파일 둘을 남김, 녹음 중 경로와 복구 경로가 같은 구간을 겹쳐 올리는 것 (audit:I06)
- v0.1.7 (2026-11-03) I05a 삽입, 같은 녹음 구간이 동시에 세 번 올라가 502 와 고아 드라이브 파일을 냄 (audit:I06)
- v0.1.8 (2026-11-03) I07 기준의 버전을 플랜 헤더 목표 버전으로 맞춤, v0.11.92 는 이미 쓰여 loop pass 가 v0.11.98 로 고침 (audit:I07)
- v0.1.8 (2026-11-03) I07 기준 버전을 v0.11.98 로 (audit:I07)
