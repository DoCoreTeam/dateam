# 03 — 단계별 작업 분해 (P0 → P1 → P2)

> 각 단계는 독립 배포 가능하도록 분리. 구현은 **사용자 승인 후** 착수.

## P0 — 원본 보존 표시 + AI 드로어 분리 + 누락 메모 환기 (저비용·고신뢰)
**목표:** 원본을 그대로 보여주고, 분해 결과를 그 아래 펼침으로 분리. DB 변경 최소.

작업:
1. (FE) `OriginGroupCard` 컴포넌트 신규 — 상단 원본 텍스트(plain) + 요약 칩 + ▾ 드로어. 기본 접힘.
2. (FE) 드로어 "업무 분해" 섹션 — `getOriginGroupLogs()`/`groupDailyLogs()`로 origin_group_id 묶음 렌더(이미 저장된 분해 항목 재사용).
3. (FE) 타임라인을 origin_group 단위로 묶어 표시 + 과거 manual 항목 단일 카드 폴백.
4. (FE) 드로어 "③ 누락 메모 환기" 섹션 — 기존 `/api/daily/memos?status=unreviewed` + clusters 연계해 이 입력과 연관 메모 표시(기존 시스템 호출만).
5. (검증) 원본 비파괴 단위/E2E, 모바일 카드, 접힘 기본.

DB: **변경 없음**(원본·묶음 이미 존재). API: 신규 없음(기존 조회 재사용).

## P1 — 중복 감지·표기 (제안까지, 자동병합 X)
**목표:** 같은/유사 업무 중복을 "후보"로 표기. 정리는 사용자 확정.

작업:
1. (BE/lib) 결정론 중복 감지 모듈 — 제목 정규화 + 유사도(task=문자열/토큰, note=기존 embedding 재사용). 임계값 SSOT.
2. (BE) analyze-work 출력 또는 조회 시 "중복 의심" 후보 계산(오늘/최근 항목 대비).
3. (FE) 드로어 "① 중복 의심" 섹션 — [무시]/[병합 요청] 후보 UI(자동 삭제 금지).
4. (DB, 확정 시만) 병합 확정 시 `daily_log_relations`에 duplicate/related 엣지 기록.
5. (검증) 유사도 단위 테스트(골든셋), 오탐율 관찰.

DB: 신규 테이블 없음(relations 재사용). 컬럼 추가 불필요(파생 계산).

## P2 — 일정성 항목 → 캘린더 반영 (확인형, 별도 스프린트)
**목표:** 일정 표현을 캘린더 후보로 제시 → 사용자 확정 시 calendar_events 생성. **자동 등록 금지(오등록=신뢰 훼손).**

작업:
1. (BE) AI 일정 추출(scheduled_at/target_date) → 캘린더 후보 산출(기존 getCalendarRecommendations 패턴 확장, INSERT 없음).
2. (FE) 드로어 "② 일정 후보" 체크리스트 — 사용자가 ☑ 후 "캘린더에 추가".
3. (BE) 확정 시 `calendar_events` INSERT(link_kind='daily_log', link_id) — 권한/RLS, 중복 등록 가드.
4. (검증) 후보 정확도, 오등록 0 확인, 캘린더 화면 반영 E2E.

DB: calendar_events 재사용(link_kind/link_id 기존). 자동 동기화·외부(Google) 연동은 **범위 외**.

## 공통 완료 기준(각 단계)
- [ ] 원본 비파괴(원본 텍스트 수정/삭제 없음) 단위·E2E 검증
- [ ] AI 산출은 후보(사용자 확정 전 DB 변경 없음) — AI UI 표준 5-3 준수
- [ ] RLS/권한(본인 데이터) 유지, default-deny
- [ ] tsc 0 · design:check · 관련 E2E
- [ ] 토큰 로깅(token-logger)·outcomes 적재 유지
