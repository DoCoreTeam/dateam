# 회의노트 목록 — 삭제버그 + 3뷰모드 + 구성 보강 — v0.7.259

## 작업
P0 삭제버그 해결 + P1 리스트/날짜별/캘린더 3뷰모드 + 목록에 부서·참석자 표시.

## 변경
- actions.ts:
  - listMeetingNotes: `.eq('user_id', user.id)` 개인 목록 한정(admin도 본인 노트만) → 유령 노트 제거. SELECT에 attendees·attendee_user_ids 추가. limitMax 상향(날짜/캘린더 뷰용).
  - deleteMeetingNote: update에 .select('id') → 0행이면 에러 반환(조용한 실패 차단).
- lib/meeting/group-by-date.ts(신규): meeting_at 기준 날짜 그룹핑 SSOT(순수함수+테스트).
- MeetingViewTabs.tsx(신규): [리스트|날짜별|캘린더] 토글, q/sort/filter 보존, ?view= URL 동기화.
- MeetingDateView.tsx(신규): 일일업무 스타일 날짜 그룹 섹션(날짜·N건 + 카드).
- MeetingCalendarView.tsx(신규): 월 달력에 회의 배치, ?ym= 월 이동.
- page.tsx: ?view 분기(list/date/calendar), 부서 id→name 맵, 제목셀에 부서·참석자 표시.

## 이유
- 삭제버그 근본: admin SELECT는 전체 허용/UPDATE는 본인만 비대칭 → 남의 노트가 보이고 삭제 0행 조용한실패. 개인목록 한정으로 "본인이 쓴 건 본인이 삭제" 원칙 성립.
- 정렬/페이지는 이미 동작(수정 거의 없음).
- 날짜별/캘린더 부재 → 신설. meeting_at 클라 그룹핑(DB변경 0).
- 목록에 부서·참석자 부재 → 제목셀 메타로 보강.

## 완료조건
- [ ] admin이 봐도 본인 노트만 목록 → 삭제 정상, 유령 노트 없음
- [ ] 0행 삭제 시 에러 표시(조용한 실패 차단)
- [ ] 리스트/날짜별/캘린더 3모드 토글 + URL 동기화
- [ ] 목록에 부서·참석자 표시
- [ ] 정렬/검색/상태필터 유지, 페이지네이션 유지
- [ ] tsc·lint·design:check 통과 + 브라우저 E2E

## 설계 결정(사용자)
- 삭제: 본인 소유 한정(개인 목록). admin 전사보기는 범위 밖(필요시 별도).
- 뷰모드: 리스트/날짜별/캘린더 3종 전부.
