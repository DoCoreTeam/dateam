# PLAN newAX: 일정을 누르면 상세가 보이고 장소를 적는다
플랜 ID: P0114
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0200
목표 버전: v0.10.945
작성: 2026-10-06
시작 커밋: a70fed08

## 목표
- 일정에 적어 둔 설명이 화면에 나온다, 지금은 저장은 되는데 그리는 코드가 없어 제목만 보인다
- 일정에 장소를 적을 수 있다, 지금은 저장할 칸 자체가 없다
- 달력 두 자리(날짜 패널·일간 보기)가 같은 상세를 쓴다

## 범위 밖
- 일정 상세의 참석자·첨부·알림 (지금 저장 자리가 없고 이번 지시에 없음)
- 지도 연동·주소 검색 (장소는 글자 한 줄로 받음)
- 월간 칸 칩에 장소를 더 그리는 것 (칸이 이미 좁아 칩 상한이 걸려 있음)
- 회의노트 달력·어드민 모니터링 달력 (일정 칩을 안 그림)

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 일정에 장소와 설명을 적어 저장하고, 그 일정을 눌러 둘 다 읽을 수 있음 (실브라우저)
- 날짜 패널과 일간 보기가 같은 부품으로 상세를 그림
- 신규 화면 문자열은 lib/terms 를 따르고 금지어·전각 대시 없음

## 참조
- LOOP.md 7절 보안 기준, 9절 U-N·F-N
- supabase/migrations/051_calendar_events.sql (표와 RLS 원본)
- apps/web/lib/calendar/calendar-surface.test.ts (달력 표면 계약)

## 항목

### I01 저장 자리에 장소를 더한다
상태: 통과
모드: 경량
범위: supabase/migrations/304_calendar_event_location.sql (신규)
감사 기준:
- psql 로 `\d calendar_events` 에 location text 칼럼이 보인다
- 보안: 표를 새로 만들지 않고 칼럼만 더하므로 RLS 는 그대로다, `select relrowsecurity from pg_class where relname='calendar_events'` 가 t 이고 정책 cal_select·cal_write 가 둘 다 남아 있음을 psql 로 확인한다
- 보안: 이 마이그레이션에 CREATE TABLE·CREATE TABLE AS·GRANT 가 한 줄도 없음을 grep 으로 확인한다
- scripts/migrate.sh 로 적용 후 --status 가 304 를 적용됨으로 표시한다
의존: 없음

### I02 서버가 장소를 주고받는다
상태: 대기
모드: 경량
범위: apps/web/app/(member)/calendar/actions.ts, apps/web/app/api/calendar/events/route.ts
감사 기준:
- CalendarEventInput 에 location 이 있고 createCalendarEvent insert·updateCalendarEvent update·getCalendarEvent select 셋 다 location 을 싣는다 (grep 으로 네 자리 확인)
- GET /api/calendar/events 응답 한 건에 description 과 location 키가 있다 (실제 호출로 확인)
- 보안: 창구를 새로 열지 않는다, 두 파일 모두 createClient + auth.getUser 로 인증을 거치고 서비스롤(createAdminClient)을 안 쓴다는 것을 읽어 확인한다
- 보안: location 은 사용자가 적는 값이다, 화면이 innerHTML 없이 텍스트로만 그린다는 것을 I04 에서 받는다, 여기서는 저장 전 trim 만 하고 질의는 supabase 매개변수로 넘긴다
- pnpm tsc --noEmit 통과
의존: I01

### I03 일정 폼에 장소 칸이 있다
상태: 대기
모드: 경량
범위: apps/web/app/(member)/calendar/EventModal.tsx
감사 기준:
- 새 일정 폼에 장소 입력칸이 있고 저장하면 payload 에 실린다
- 수정 모드로 열면 저장돼 있던 장소가 칸에 채워진다 (getCalendarEvent 가 준 값)
- 라벨은 옆 칸들과 같은 꼴이고 전각 대시·금지어가 없다
- pnpm tsc --noEmit 통과
의존: I02

### I04 일정 상세를 그리는 부품을 만든다
상태: 대기
모드: 경량
범위: apps/web/components/calendar/EventRow.tsx (신규), apps/web/components/calendar/event-row.module.css (신규)
감사 기준:
- 줄을 누르면 펼쳐져 시작~종료 시각, 장소, 설명이 나온다
- 장소나 설명이 비어 있으면 그 줄을 안 그린다 (빈 라벨만 남지 않는다)
- 설명은 여러 줄을 그대로 보존하고 텍스트로만 그린다 (dangerouslySetInnerHTML 없음, grep 0건)
- 내 일정이 아니면(is_mine === false) 수정·삭제 단추를 안 그린다
- 업무·회의에서 온 일정이면(link_kind) 수정 대신 원본으로 가는 길을 준다
- aria-expanded 로 펼침 상태를 알린다
의존: I02

### I05 날짜 패널과 일간 보기가 같은 상세를 쓴다
상태: 대기
모드: 경량
범위: apps/web/app/(member)/calendar/DayDetailPanel.tsx, apps/web/app/(member)/calendar/CalendarBoard.tsx
감사 기준:
- 두 파일 모두 EventRow 를 쓰고 일정 줄을 각자 다시 그리지 않는다 (grep 으로 확인)
- 날짜 패널에서 일정을 누르면 설명과 장소가 보인다
- 일간 보기에서 일정을 누르면 같은 것이 보인다
- 수정을 누르면 그 자리에서 EventModal 이 채워진 채 열린다 (화면 전환 0회)
- pnpm tsc --noEmit, pnpm lint 통과
의존: I04

### I06 가드로 잠근다
상태: 대기
모드: 경량
범위: apps/web/lib/calendar/calendar-surface.test.ts, apps/web/package.json
감사 기준:
- 「일정 상세가 제목만 보이지 않는다」 계약을 단정으로 적는다 (설명·장소를 그리는 자리가 두 화면 공용 부품인지)
- 서버 세 자리(create·update·get)가 location 을 빠뜨리면 실패한다
- 가드를 일부러 깨 실패를 확인하고 되돌린다, 확인한 사실을 pass --notes 에 적는다
- 시험 파일이 apps/web/package.json 의 test 한 줄에 이미 등재돼 있는지 보고, 없으면 등재하고 총 시험 수가 늘어난 것을 확인한다
의존: I05

### I07 실브라우저로 확인하고 업데이트 내역에 적는다
상태: 대기
모드: 경량
범위: apps/web/lib/changelog/entries.ts
감사 기준:
- 깨끗한 판으로 띄워 장소와 설명을 적은 일정을 저장하고, 그 일정을 눌러 둘 다 읽히는 것을 실브라우저에서 확인한다 (F-10)
- 수정으로 다시 열었을 때 장소와 설명이 칸에 채워져 있는 것을 확인한다
- 업데이트 내역에 이번 버전 블록을 더한다
- pnpm test, pnpm build 통과
의존: I06

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-06) 최초 작성 (ins_0200)
