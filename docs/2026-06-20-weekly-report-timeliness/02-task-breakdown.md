# 작업 분해 (구현 착수 시 순서 — 현재 미진행)

> 각 단계는 ADD→MIGRATE→DROP 원칙, 기존 데이터 보호(상태플래그 무단 덮어쓰기 금지) 준수.

1. **활동로그 기반** — `weekly_report_activity` 테이블 + append-only RLS(UPDATE/DELETE deny).
   - `replace_weekly_report` RPC에 INSERT 로깅 추가(create/edit 구분 = 기존 행 존재 여부).
   - 과거분 best-effort 백필(기존 created_at/updated_at → create/edit 1건씩).
2. **취합시각** — `dept_weekly_reports.confirmed_at/by` 추가. `saveDeptReport(confirm=true)`(`org-actions.ts:145`)에서 최초/최신 기록.
3. **판정 로직** — `get_weekly_report_timeliness` RPC/뷰 + `lib/weekly-report/timeliness.ts`(토/월 백스톱·취합선·status 계산, 단위테스트 대상).
4. **표시 UI** — org/team 탭 상태 보드 + 타임라인 툴팁 + 부서 정시율. 배지 SSOT 토큰.
5. **작성 안내** — 로그인 시 미작성/지연이면 모달(안내 톤) + 사이드/리스트 배지. 본 적 있으면 재안내 억제.
6. **증빙 export** — admin 전용 정시율·이력 CSV(기간·부서 필터).

## 의존성/리스크
- 이메일 발송 인프라 미확인 → 1차는 인앱(모달/배지)만. (요구 R7과 부합)
- 백필은 근사치(과거 정확한 수정 이력은 복원 불가) → 증빙은 **도입 시점 이후**가 정식.
