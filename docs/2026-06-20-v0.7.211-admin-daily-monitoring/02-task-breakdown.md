# 02 · 작업 분해 (Task Breakdown)

> v0.7.211 · 2026-06-20 · 기획 확정(구현 전) · 담당 표기는 DC 에이전트 그룹

## Phase 1 — MVP "달력에서 보고 → 누가 썼나 + 안 썼나"

| ID | 작업 | 담당 | 산출 |
|----|------|------|------|
| T1-1 | `lib/admin/daily-monitoring.ts` 신설: 월 집계 쿼리(날짜별 작성인원/블로커), 선택일 리스트 쿼리, 미작성자 차집합, 시각/“수정됨” 포맷 SSOT | 🟩 DC-DEV-BE | lib 함수 + 타입 |
| T1-2 | `page.tsx` 재구성: requireAdmin 통일, 월/선택일 데이터 페치, props 전달 | 🟩 DC-DEV-BE | 서버 컴포넌트 |
| T1-3 | `MonitoringCalendar.tsx`: 월 그리드 + 셀 작성인원 뱃지 + 날짜선택(URL) | 🟩 DC-DEV-FE | Client 컴포넌트 |
| T1-4 | `DayDetailPanel.tsx`: 선택일 KPI 요약 + 작성자 리스트(작성일시 컬럼·“수정됨”) + 미작성자 명단 | 🟩 DC-DEV-FE | Client 컴포넌트 |
| T1-5 | 디자인 토큰/table-card/input-field 적용, 반응형 검증 | 🟩 DC-DEV-FE | — |
| T1-6 | 테스트: 집계 정확성·미작성자 차집합·시각 포맷·is_onboarding 제외 | 🟥 DC-QA | *.test.ts |

**Phase1 완료 = 사용자 핵심 요구(FR-1·4·5·10) 충족.**

## Phase 2 — 탐색 강화

| ID | 작업 | 담당 |
|----|------|------|
| T2-1 | 셀 블로커(▲)·미작성 농도 시각화 | 🟩 DC-DEV-FE |
| T2-2 | 리스트 내용·이름 검색(ilike + trgm 인덱스) | 🟩 DC-DEV-BE |
| T2-3 | 정렬 헤더 토글(화이트리스트) + 부서/타입/task_kind 필터 | 🟩 DC-DEV-FE/BE |
| T2-4 | 서버 페이지네이션(.range + count, LIMIT 2000 폐기) | 🟩 DC-DEV-BE |
| T2-5 | 상태 URL 동기화 + 로딩/빈/에러 3종 UI | 🟩 DC-DEV-FE |
| T2-6 | 테스트: 검색/정렬/필터/페이지 경계 | 🟥 DC-QA |

## Phase 3 — 감사·평가 보강

| ID | 작업 | 담당 |
|----|------|------|
| T3-1 | 월 작성률 추이(상단 미니 통계) | 🟩 DC-DEV-FE |
| T3-2 | CSV 내보내기(선택 기간·필터 반영, KST 시각, "수정됨" 컬럼 포함) | 🟩 DC-DEV-BE |
| T3-3 | 내보내기 권한 재확인 + 다운로드 로깅 검토 | 🟥 DC-SEC |

## Phase 4 — (범위 밖, 별도 승인) 완전 감사추적

| ID | 작업 | 비고 |
|----|------|------|
| T4-1 | `daily_logs_audit` 테이블 + 트리거(변경 전/후 보관) | **마이그레이션 발생** — 별도 기획 |
| T4-2 | 로그별 수정 이력 타임라인 뷰 | 감사 강도 상향 시에만 |

## 의존 관계

```
T1-1(lib) ─┬─ T1-2(page) ─┬─ T1-3(calendar)
           │              └─ T1-4(panel)
           └──────────────── T1-6(test)
Phase2/3는 Phase1 머지 후 착수
```

## 영향 파일 (예상)

- 신설: `lib/admin/daily-monitoring.ts`, `MonitoringCalendar.tsx`, `DayDetailPanel.tsx`, 테스트
- 수정: `app/admin/daily-logs/page.tsx`(재구성)
- 변경 없음: DB, 멤버 화면, RLS 정책
