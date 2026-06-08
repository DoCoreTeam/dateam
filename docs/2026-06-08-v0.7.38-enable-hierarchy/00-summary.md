# v0.7.38 — 조직 계층 권한 실가동

작업: `weekly_report_hierarchy_enabled` 플래그를 'false'→'true'로 전환해 조직도 계층 격리 활성화
대상:
- `supabase/migrations/074_enable_weekly_report_hierarchy.sql` (신규, DB 적용 완료)
- `package.json` / `apps/web/package.json` / `CLAUDE.md` / `AGENTS.md` (v0.7.38)

이유: 부서장 head_user_id 매핑(7/7 부서 완료)이 갖춰져 계층 권한을 실제 가동 가능

영향 (단일 플래그가 4영역 동시 게이팅):
- weekly_reports(개별): 전사 열람 → 본인+관할 부서 (평팀원 동료 보고 비가시 = 의도된 격리)
- daily_logs: 부서장이 부서원 열람 가능
- dept_weekly_reports: 변화 없음(원래 격리)
- calendar_events: 부서장/임원이 부서원 일정 열람 (범위 외였으나 사용자 승인하 포함)
- CRM(거래처/연락처/딜/리드): 정책 009로 플래그 무관 → 전사 열람 유지 (격리 없음)

검증: DB `private.hierarchy_enabled()` = true 확인
리뷰: 🟥 DC-REV APPROVED-WITH-NOTES 88/100
롤백: 플래그 'false'로 즉시 복귀 (데이터/정책 무손실)
운영 권고: 평팀원에게 "동료 주간보고가 더 이상 보이지 않음" 공지 권장
