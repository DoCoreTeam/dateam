# 01 · 아키텍처 — 데이터·AI·권한

> 기획 전용. SQL/구조는 설계 청사진(미적용).

## A. 전체 그림
```
[등록] 날짜클릭 모달 ─┬─ 자연어 1줄 → /api/ai/analyze-work(재사용) → {targetDate,scheduledTime} → 폼 자동채움
                     └─ 구조 폼(제목·시작·종료·종일·반복·연계)
                                  │ createCalendarEvent (server action)
                                  ▼
                        calendar_events (신규)  ──link_kind/link_id──▶ daily_logs / weekly_reports / memo
                                  │ RLS: 본인 + 조직계층(private 헬퍼 재사용)
[조회] 월/주 뷰 ◀── getEvents(범위) + 반복 전개(rrule) + daily_logs 병합 표시
[추천] 규칙 스캔(planned·이월·plan·미처리memo) → Gemini 종합 → 추천카드 → 원클릭 createCalendarEvent(source='ai')
```

## B. 데이터 모델 — `calendar_events` (D1)
```sql
-- 설계안 (미적용)
create table calendar_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  department_id uuid references org_nodes(id),          -- 작성시점 소속(계층 가시성용, 동결)
  title         text not null,
  description   text,
  start_at      timestamptz not null,
  end_at        timestamptz,                            -- null이면 시점 일정
  all_day       boolean not null default false,
  rrule         text,                                   -- iCal RRULE (반복). null=단발
  source        text not null default 'user' check (source in ('user','ai','rule')),
  -- 업무 연계 (핵심)
  link_kind     text check (link_kind in ('daily','weekly','memo')),
  link_id       uuid,                                   -- daily_logs.id / weekly_reports.id / memo(daily_logs).id
  status        text not null default 'scheduled' check (status in ('scheduled','done','canceled')),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index idx_cal_user_start on calendar_events (user_id, start_at);
create index idx_cal_dept_start on calendar_events (department_id, start_at);
create index idx_cal_link on calendar_events (link_kind, link_id);
```
- **시간 모델**: start_at/end_at(timestamptz) + all_day. 종일은 start_at=자정, all_day=true로 표현.
- **반복**: iCal `rrule` 문자열 저장(예: `FREQ=WEEKLY;BYDAY=MO`). 저장은 규칙 1건, 조회 시 범위 내 인스턴스로 전개(서버 또는 클라 `rrule.js`). 예외/수정 인스턴스는 후속(별도 override 테이블) — 1차 범위 외.
- **업무 연계**: `link_kind`+`link_id`. FK 강제 대신 소프트 링크(3개 테이블 분기라 polymorphic) — 조회 시 link_kind로 join 분기. 무결성은 앱에서 관리(원본 삭제 시 link_id 정리 트리거 선택).

## C. 권한 — 조직 계층 RLS 재사용 (D4)
```sql
-- 설계안. daily_logs와 동일 정책 패턴 — 기존 private 헬퍼 그대로
alter table calendar_events enable row level security;
create policy cal_select on calendar_events for select to authenticated using (
  user_id = (select auth.uid())
  or (exists (select 1 from profiles where id=(select auth.uid()) and role='admin' and deleted_at is null))
  or ( (select private.hierarchy_enabled())
       and ( user_id = any(private.my_readable_user_ids())   -- 관할 팀원 일정
             or (select private.is_executive()) ) )
);
create policy cal_write on calendar_events for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
```
- 본인 일정 쓰기, 본인+관할(부서장)+전사 조회. **신규 권한 로직 0** — 050에서 만든 `my_readable_user_ids`/`is_executive`/`hierarchy_enabled` 재사용. 플래그 게이팅 일관(OFF면 본인+admin).
- `department_id`는 작성 시점 소속 동결(`v_user_departments`) — 조직 이동 후에도 가시성 안정.

## D. 자연어 등록 — analyze-work 재사용 (D2)
- 기존 `/api/ai/analyze-work`(Gemini NDJSON)가 `targetDate`/`scheduledTime`/`title`/`priority` 추출. 
- 캘린더 모달의 "자연어 1줄" → 동일 API 호출(단건 모드) → 응답으로 폼 프리필(시작=targetDate+scheduledTime, 제목=title). 사용자가 검토·수정 후 저장.
- **새 AI 엔드포인트 불필요** — 프롬프트에 "일정 관점(종료시간/종일 추정)" 힌트만 추가 검토. 신규 일정 전용 파서가 필요하면 `analyze-schedule` 분기(선택, 2차).

## E. AI 추천 — 규칙 + Gemini (D3)
```
1차 규칙 스캐너 (서버, 비용0):
  - daily_logs: entry_type='planned' 미완료 + target_date 미설정/과거 → "일정 잡을 후보"
  - 이월(carryover): 지난주 plan → 이번주 일정 후보
  - weekly_reports: 이번주 plan 항목 → 요일 분배 후보
  - memo: memo_status='new'(미처리) 오래된 것 → 후속 일정 후보
2차 Gemini 종합 (1회 호출):
  - 위 후보 + 최근 daily/weekly/memo 컨텍스트를 주고
  - "다음 주 추천 일정 N건"을 {title,start_at,reason,link_kind,link_id}로 반환
  - org_content META gemini 키 재사용
3차 표시: 캘린더 상단/사이드 "추천 일정" 카드 → [등록](createCalendarEvent source='ai') / [무시]
트리거: 수동 "추천 받기" 버튼 + (선택) 주1회 자동 — 매 페이지 로드 자동호출 금지(비용).
```

## F. 조회·표시
- 월/주 뷰: `getEvents(rangeStart,rangeEnd)` → calendar_events 범위 조회 + rrule 전개 + 기존 daily_logs(target_date/scheduled_at) **병합 표시**(색/아이콘으로 일정 vs 업무 구분).
- 일정 클릭 → 상세(연계 업무 점프 링크) / 편집 / 삭제.
- daily_logs와 calendar_events는 별개 소스지만 한 캘린더에 통합 렌더(범례로 구분).

## G. OSS/기술 메모 (🟦 DC-OSS 관점)
- 반복: **rrule.js**(iCal RRULE 파서/전개) — 표준·검증됨. 직접 구현 금지.
- 캘린더 UI: 기존 자체 월/주 뷰 유지(FullCalendar 도입은 번들·러닝커브 커 보류) — 등록 모달/일정 레이어만 추가.
- 자연어: 기존 Gemini analyze-work 재사용(신규 의존성 0).

## H. 외부 동기화 (범위 외 — 원칙만)
- 구글 캘린더(이미 GOOGLE_CLIENT_ID env 존재) 양방향은 2차. 설계 시 `calendar_events`에 `external_id`/`provider` 컬럼 여지만 남김.
