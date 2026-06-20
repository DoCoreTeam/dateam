# 01 · 아키텍처 — 캘린더형 모니터링

> v0.7.211 · 2026-06-20 · 기획 확정(구현 전)

## 1. 화면 구조 (3블록, 단일 페이지)

```
┌─────────────────────────────────────────────────────────┐
│ 일일업무 모니터링                          [2026년 6월 ◀ ▶]│  ← 헤더 + 월 네비
│ ─────────────────────────────────────────────────────────│
│ 【A. 캘린더】 셀 = 작성인원수 ● / 미작성 농도 / 블로커 ▲      │  ← 1차 진입면
│  ...  [10]●22★ ...   (오늘 테두리, 주말 흐림, 선택일 하이라이트) │
│ ─────────────────────────────────────────────────────────│
│ 【B. 선택일 요약】 6/10(수) 작성 22/29 · 미작성 7 · 블로커 2   │  ← KPI 바
│  [🔍검색][부서▾][타입▾][task_kind▾][정렬▾]                  │
│ ─────────────────────────────────────────────────────────│
│ 【C. 작성자 리스트】 작성일시·멤버·부서·타입·내용 (정렬/페이지) │  ← 상세
│  ─ 미작성(7): 정OO, 최OO ...                                │
└─────────────────────────────────────────────────────────┘
```

## 2. 컴포넌트 분해

| 컴포넌트 | 종류 | 책임 | 재사용 출처 |
|----------|------|------|------------|
| `daily-logs/page.tsx` | Server | 권한검증 + 월 집계·선택일 데이터 페칭 + 초기 렌더 | 기존 파일 재구성 |
| `MonitoringCalendar.tsx` | Client | 월 그리드, 셀 뱃지, 날짜선택(URL push) | `/calendar` 그리드 패턴 |
| `DayDetailPanel.tsx` | Client | 선택일 요약 KPI + 검색/정렬/필터 + 리스트 + 미작성자 | `admin/users/UserTable` 검색·정렬 |
| `lib/admin/daily-monitoring.ts` | lib(SSOT) | 집계/조회 쿼리·타입·포맷 함수 모음 | 신설 |

> 컴포넌트 300줄 이내 분리. 표시 포맷(작성시각·"수정됨" 판정)은 lib에 SSOT로 두고
> 모든 뷰가 import (CLAUDE.md "표시 로직도 SSOT" 정책).

## 3. 데이터 흐름

```
[page.tsx] (Server, createAdminClient — RLS 우회)
  ├─ requireAdmin 게이트
  ├─ 월 집계 쿼리 → 캘린더 셀 데이터 (날짜별 작성인원/블로커유무)
  ├─ 선택일(?date=) 리스트 쿼리 → 작성자 상세
  ├─ 활성 멤버 목록(profiles) → 미작성자 차집합 계산
  └─ props → MonitoringCalendar + DayDetailPanel
        └─ 날짜클릭/검색/정렬 = URL searchParams 갱신 → 서버 재페치 (SWR/router)
```

## 4. URL 상태 설계 (공유·북마크 가능, 감사 재현성)

```
/admin/daily-logs?month=2026-06&date=2026-06-10
  &q=키워드&dept=<org_node_id>&type=blocker&kind=personal
  &sort=logged_at&dir=desc&page=1
```

- `month`: 캘린더 표시 월 (없으면 이번달)
- `date`: 선택일 (없으면 오늘 또는 월 첫 작성일)
- 나머지: 리스트 필터/정렬/페이지 — 전부 화이트리스트 검증

## 5. 권한·보안 경계

- `createAdminClient()`(service-role)로 RLS 우회 — 기존 admin 패턴 유지
- 페이지 진입 게이트: 현행 인라인 검증(L38-44)을 **`lib/auth/requireAdmin.ts`로 통일** 권장
- service-role 쿼리는 **항상 명시적 필터**로 범위 한정(default-deny 정신): is_onboarding 제외 등
- CSV 내보내기(Phase3)는 admin 권한 재확인 + 다운로드 행위 로깅 고려

## 6. DB 영향

- **마이그레이션 0건** (Phase1~3). 필요한 컬럼·인덱스 모두 기존 존재:
  - `daily_logs_date`(log_date DESC) — 월 집계/선택일 조회
  - `idx_daily_logs_content_trgm`(GIN) — 내용 검색
  - `idx_daily_logs_dept_task` — task_kind/부서 필터
  - `daily_logs_not_onboarding`(partial) — 실습행 제외
- **Phase4(감사 강화, 범위 밖)**: 변경 이력 보관용 `daily_logs_audit` 테이블 신설 시에만 마이그레이션 발생

## 7. 디자인 시스템 준수

- 캘린더/카드/리스트 전부 디자인 토큰(globals.css `:root`) 사용, hex/치수 하드코딩 금지
- 리스트 테이블 = `table-base table-card`(모바일 카드 자동 변환, 가로스크롤 금지)
- 폼 입력 = `input-field`, 라벨 = `label`
- 페이지 = `MobileShell` `page-inner` 전체폭 반응형 (폭 클램프 금지)
- 시각 포맷 = `Intl` 기반 공용 함수, KST 고정
