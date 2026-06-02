# 03 · 작업 분해 (Phase)

## Phase 1 — 데이터·등록 기본 (MVP, 가치 즉시)
- [ ] 마이그레이션: `calendar_events` + 인덱스 + RLS(본인+조직계층, 기존 헬퍼 재사용)
- [ ] 서버액션: `createCalendarEvent` / `updateCalendarEvent` / `deleteCalendarEvent` / `getEvents(range)`
- [ ] `EventModal`(구조 폼: 제목·시작·종료·종일·설명) + 날짜클릭 진입
- [ ] 월/주 뷰에 calendar_events 레이어 렌더(daily_logs 병합·범례)
- [ ] 일정 상세 팝오버 + 편집/삭제
- [ ] 검증: 등록→캘린더 즉시 반영, 본인만 쓰기, tsc/build, 브라우저

## Phase 2 — 자연어 + 업무 연계
- [ ] EventModal "자연어 1줄" → analyze-work 호출 → 폼 프리필
- [ ] (필요 시) analyze-work 프롬프트에 일정 관점(종료/종일 추정) 힌트 추가 or `analyze-schedule` 분기
- [ ] 연계(link_kind/link_id) UI: 일일업무/주간보고/메모 검색·선택
- [ ] 일정↔원본 업무 상호 점프(상세 팝오버 링크)
- [ ] 검증: 자연어→정확 파싱, 연계 점프 동작

## Phase 3 — AI 추천
- [ ] 규칙 스캐너: planned 미일정·이월·weekly plan·미처리 memo → 후보 도출
- [ ] Gemini 종합 추천 액션(후보+컨텍스트 → 추천 N건 {title,start_at,reason,link})
- [ ] `RecommendCard` UI + [등록]/[무시] + 근거 표시
- [ ] 비용 가드: 수동 트리거(+선택 주1회), 매로드 자동호출 금지
- [ ] 검증: 추천 정확/근거, 원클릭 등록

## Phase 4 — 계층/공유·반복 마감
- [ ] 부서장 "팀 일정" 오버레이(관할 팀원 조회전용)
- [ ] 반복(rrule.js) 저장·전개 + 범위 조회 성능
- [ ] 검증: 계층 가시성·반복 전개·회귀

## Phase 5 — 마무리
- [ ] DC-QA/SEC/REV · GATE 1-5 · 버전업 · 커밋

## 의존성
```
P1(테이블·등록·뷰) → P2(자연어·연계) → P3(추천) → P4(계층·반복)
                     기존 자산 재사용: analyze-work(P2), private RLS헬퍼(P1/P4), Gemini키(P3)
```

## 모델 배정(구현 시)
- 🟩 DC-DEV-DB: calendar_events·RLS·인덱스
- 🟩 DC-DEV-BE: 액션·추천 규칙스캐너·Gemini 추천
- 🟩 DC-DEV-FE: EventModal·Popover·RecommendCard·뷰 레이어
- 🟦 DC-DEV-INT(선택): 구글 캘린더 동기화(2차)
- 🟥 DC-SEC: 일정 RLS·polymorphic link 무결성 / 🟥 DC-QA: 권한·반복·자연어 매트릭스
