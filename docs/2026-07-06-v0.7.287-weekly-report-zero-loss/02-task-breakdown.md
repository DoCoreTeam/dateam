# 02 · 작업 분해 + DB 스키마

> 구현 순서 = 배포 안전 순서. **스냅샷/단일writer가 같은 배포**에 나가야 06-29 즉시조치가 성립.

## T1 · DB — 신규 마이그 `143_weekly_report_snapshots.sql` (무손상, 추가+REPLACE만)

### 1) 스냅샷 테이블 (append-only)
```sql
CREATE TABLE weekly_report_snapshots (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start    DATE        NOT NULL,
  department_id UUID        REFERENCES org_nodes(id),
  rows_json     JSONB       NOT NULL,          -- 그 순간 확정본 전체(category/performance/plan/issues/seq 배열)
  row_count     INT         NOT NULL DEFAULT 0,
  reason        TEXT        NOT NULL DEFAULT 'manual_save'
                            CHECK (reason IN ('manual_save','restore','delete_all','pre_deploy_seed')),
  actor_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  taken_at      TIMESTAMPTZ NOT NULL DEFAULT now()   -- UTC 저장, 표시 KST
);
CREATE INDEX idx_wrs_user_week ON weekly_report_snapshots (user_id, week_start, taken_at DESC);

ALTER TABLE weekly_report_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY wrs_select ON weekly_report_snapshots
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY wrs_insert ON weekly_report_snapshots
  FOR INSERT WITH CHECK (actor_id = auth.uid());
-- UPDATE/DELETE 정책 없음 → append-only 불변
```
> 빈 스냅샷(첫 작성 직전 0행)도 남길지: **남긴다**(row_count=0). 복원 UI에서 "빈 상태로 되돌리기"도 안전하게 가능. rows_json = '[]'.

### 2) `replace_weekly_report` 재정의 = 120(로깅+dept) + 141(seq) + 스냅샷
```sql
CREATE OR REPLACE FUNCTION replace_weekly_report(p_week_start DATE, p_rows JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_dept   UUID;
  v_prev   JSONB;
  v_cnt    INT;
  v_existed BOOLEAN;
BEGIN
  SELECT department_id INTO v_dept FROM v_user_departments WHERE user_id = auth.uid() LIMIT 1;

  -- (A) 스냅샷: DELETE 직전 현재 확정본 전체를 보관 (같은 트랜잭션 → 원자성)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'category',category,'performance',performance,'plan',plan,'issues',issues,'seq',seq)
           ORDER BY category, seq), '[]'::jsonb), count(*)
    INTO v_prev, v_cnt
    FROM weekly_reports WHERE user_id = auth.uid() AND week_start = p_week_start;
  v_existed := v_cnt > 0;

  INSERT INTO weekly_report_snapshots (user_id, week_start, department_id, rows_json, row_count, reason, actor_id)
  VALUES (auth.uid(), p_week_start, v_dept, v_prev, v_cnt, 'manual_save', auth.uid());

  -- (B) 파괴적 교체 (기존과 동일하되 스냅샷이 선행됨)
  DELETE FROM weekly_reports WHERE user_id = auth.uid() AND week_start = p_week_start;

  INSERT INTO weekly_reports (user_id, week_start, category, performance, plan, issues, department_id, seq, deleted_at)
  SELECT auth.uid(), p_week_start,
         (elem->>'category')::text, (elem->>'performance')::text,
         (elem->>'plan')::text, (elem->>'issues')::text, v_dept, (ord-1)::int, NULL
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(elem, ord);

  -- (C) 활동 로그 복원 (120) + content_hash
  INSERT INTO weekly_report_activity (user_id, week_start, department_id, action, actor_id, content_hash)
  VALUES (auth.uid(), p_week_start, v_dept,
          CASE WHEN v_existed THEN 'edit' ELSE 'create' END, auth.uid(), md5(p_rows::text));
END; $$;
```
> `reason`을 파라미터화할지: 복원 경로도 이 RPC를 타면 스냅샷 reason이 'manual_save'로 찍힘. 정확성을 위해 **선택적 3번째 인자 `p_reason DEFAULT 'manual_save'`** 추가 검토(오버로드 아닌 default 인자). 상세는 T4 복원 액션에서 확정.

### 3) 배포 시 현재 확정본 시딩 (즉시 안전조치, 무손상)
```sql
INSERT INTO weekly_report_snapshots (user_id, week_start, department_id, rows_json, row_count, reason, actor_id)
SELECT user_id, week_start, (array_agg(department_id))[1],
       jsonb_agg(jsonb_build_object('category',category,'performance',performance,
         'plan',plan,'issues',issues,'seq',seq) ORDER BY category, seq),
       count(*), 'pre_deploy_seed', user_id
FROM weekly_reports WHERE deleted_at IS NULL
GROUP BY user_id, week_start;
```
> 이도현 06-29 5개 포함 전 사용자 현재본이 스냅샷 1건씩 확보됨 → 배포 순간부터 복원 가능.

## T2 · BE — draft 확정본 sync 제거 (Layer 1)
- `app/api/weekly-report/draft/route.ts` PUT: `replace_weekly_report` 호출 블록(라인 130~143) **제거**. items 저장(`replace_weekly_report_items`)까지만. 응답에서 `synced` 필드 정리.
- 확인: `itemsToWeeklyRows` 서버 사용처 남는지 grep → 안 쓰면 import 정리(내 변경분만).

## T3 · BE — 복원 서버액션 (Layer 2)
- `actions.ts`에 `restoreWeeklyReportSnapshot(snapshotId)` 추가:
  - 스냅샷 조회(RLS로 본인만) → `rows_json` → **폼 프리필용으로 반환** (기본 UX: 폼 로드 후 사용자 저장).
  - (옵션 B) `restoreDirect`: rows를 `replace_weekly_report(p_reason='restore')`로 즉시 확정본 반영. 복원 직전 상태도 자동 스냅샷.

## T4 · FE — 편집 이력 패널 + 복원 모달 (Layer 2)
- 신규 `WeeklyEditHistory.tsx`: 주차별 스냅샷 목록(KST 시각·항목수·사유 배지) + [복원].
- 복원 모달: 표준 모달(useEscClose, tape-title, 광원형 shadow, backdrop rgba(15,23,42,0.5)) + 변경 미리보기(현재 vs 복원본 항목수).
- 토큰/공용 컴포넌트만. RichText로 미리보기 렌더.

## T5 · FE 배선 + 서버조회
- `weekly-report/page.tsx`: 해당 주차 스냅샷 로드(최근 N개) → 패널에 전달.
- 진입점: 주간보고 폼 헤더에 "편집 이력 ▾" 토글.

## T6 · 테스트 (03 참조)
- kst/무손상/단일writer 가드 테스트 + 스냅샷 RPC 단위테스트 + E2E(저장→AI반영→복원 시나리오).

## 파일 영향 요약
| 유형 | 파일 | 변경 |
|---|---|---|
| DB | `supabase/migrations/143_weekly_report_snapshots.sql` | 신규(테이블+RLS+RPC+시딩) |
| BE | `app/api/weekly-report/draft/route.ts` | 확정본 sync 제거 |
| BE | `app/(member)/weekly-report/actions.ts` | 복원 액션 추가 |
| FE | `app/(member)/weekly-report/WeeklyEditHistory.tsx` | 신규 |
| FE | `app/(member)/weekly-report/page.tsx` | 스냅샷 로드·배선 |
| 테스트 | `lib/weekly-report/*.test.ts` + e2e | 신규/보강 |
