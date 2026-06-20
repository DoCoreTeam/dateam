# 아키텍처 / 데이터 모델 (기획 전용)

## 1. 현재 구조에서 확인된 사실 (탐색 근거)
| 발견 | 근거 | 설계 영향 |
|---|---|---|
| weekly_reports 저장=제출, 제출시각 없음 | `001_initial_schema.sql:70-94` | 작성시각용 컬럼/로그 신설 필요 |
| 저장 RPC가 DELETE+INSERT | `033_replace_weekly_report_rpc.sql`, `047_*` | `created_at`/`updated_at`이 매 저장 리셋 → **불변 로그 필수** |
| 취합 = `dept_weekly_reports.status='confirmed'` | `048_dept_weekly_reports.sql:6-43` | 취합 앵커. 단 `confirmed_at` 없음 → 신설 |
| `source_hash`로 재취합 필요 감지 | `048_*` | "취합 후 수정=지연"과 동일 신호, 재사용 |
| org-scope 권한 | `lib/org-scope.ts:40-179`, `046/047/098_*` RLS | 표시 권한 그대로 상속 |
| 주차 = week_start(월요일 DATE) | `001_*` CHECK DOW=1 | 토/월 백스톱 계산의 기준점 |

## 2. 신규/변경 데이터 모델 (ADD→MIGRATE→DROP, 롤백 가능 — *미적용*)

### ① `weekly_report_activity` (append-only · 증빙 핵심)
```
id            UUID PK
user_id       UUID  FK profiles
week_start    DATE  (월요일)
department_id UUID  FK org_nodes  -- 작성시점 부서 동결(보고서와 동일 정책)
action        TEXT  CHECK in ('create','edit','delete')
occurred_at   TIMESTAMPTZ DEFAULT now()
actor_id      UUID  FK profiles   -- 보통 user_id, 대리수정 추적용
content_hash  TEXT  NULL          -- 의미있는 변경 식별(공백만 수정 제외 등)
```
- **UPDATE/DELETE 금지 RLS** → 변경 불가 이력 = 평가 증빙.
- 기록 위치 = `replace_weekly_report` RPC 내부 INSERT(트리거보다 정확: DELETE+INSERT 노이즈 회피).
- 최초작성 = MIN(occurred_at, action='create'), 최종작성 = MAX(occurred_at, action≠'delete').

### ② `dept_weekly_reports` 컬럼 추가
```
+ confirmed_at TIMESTAMPTZ NULL   -- status→'confirmed' 전이 시 기록(재취합=최신값)
+ confirmed_by UUID NULL FK profiles
```

### ③ 조회 `get_weekly_report_timeliness(p_week_start DATE)` (RPC/뷰)
- 출력: 부서·멤버별 `{ status, first_at, last_at, confirmed_at, sat_due, mon_due, delay_minutes }`
- RLS(org-scope) 상속 → 볼 수 있는 사람만.
- status 계산 = §요구사항 R3/R4 + 판정룰표.

## 3. 표시 SSOT
- 배지 색/라벨 = `lib/tokens/status-colors.ts` 계열에 `TIMELINESS_*` 추가(컴포넌트 인라인 색맵 금지).
- 상태/지연시간 포맷 = `lib/weekly-report/timeliness.ts` 공용 함수(뷰마다 복붙 금지).
- 렌더 경로: weekly-report `?tab=org` / `team`(실제 활성 경로에서 검증).

## 4. 권한 매트릭스
| 행위 | 주체 |
|---|---|
| 상태 보드/배지 보기 | 보고서 가시성과 동일(본인/같은부서/관할서브트리/전사) |
| 작성 안내 모달 수신 | 본인(미작성·지연 시) |
| 정시율/이력 export | **admin만** |
