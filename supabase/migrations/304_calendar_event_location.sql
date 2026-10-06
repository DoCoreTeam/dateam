-- 304_calendar_event_location.sql
-- 일정에 장소를 적을 자리. 가산적 — 칼럼 하나만 더한다.
--
-- 사용자 지적(2026-10-06): *"일정에 부가 설명을 작성을 했다면 일정을 눌렀을때 상세정보를
-- 볼 수 있어야함 근데 우측에 제목만 나옴, 그리고 장소가 없음"*.
-- 설명(description)은 051 부터 있었고 그리는 코드가 없었을 뿐이지만, **장소는 저장할 칸이
-- 아예 없었다** — 적을 데가 없으면 사람은 제목 끝에 괄호로 붙인다.
--
-- 표를 새로 만들지 않으므로 RLS 와 정책(cal_select·cal_write)은 051 것이 그대로 덮는다.
-- 사본(CREATE TABLE AS)을 뜨지 않는 이유가 이것이다 — 사본은 원본 잠금을 안 물려받는다.
alter table calendar_events add column if not exists location text;

comment on column calendar_events.location is '일정 장소 한 줄. 사용자가 적는 값이라 화면은 텍스트로만 그린다';
