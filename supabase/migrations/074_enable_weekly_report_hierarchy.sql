-- 074_enable_weekly_report_hierarchy.sql
-- 계층 권한 실가동: 조직 계층 격리 ON.
-- 이 단일 플래그가 게이팅하는 영역(전부 동시 활성):
--   · weekly_reports(개별)      : 전사 열람 → 본인+관할 부서로 제한        (047/050)
--   · daily_logs                : 부서장이 부서원 열람 가능                  (049/050)
--   · dept_weekly_reports       : (원래부터 격리, 변화 없음)                 (048)
--   · calendar_events           : 부서장/임원이 부서원 일정 열람 가능        (051)  ← 사용자 승인하 포함
-- CRM(accounts/contacts/deals/lead_intakes)은 별도 정책(009)으로 플래그와 무관 → 전사 열람 유지.
-- private.hierarchy_enabled()가 이 값을 읽어 위 RLS 정책의 ON/OFF를 결정한다.
-- 전제: org_nodes의 department head_user_id 매핑 완료 (적용 시점 7/7 부서 지정 확인).
-- 롤백: value='false'로 되돌리면 즉시 기존(본인+admin) 동작으로 복귀.

update public.system_settings
set value = 'true'
where key = 'weekly_report_hierarchy_enabled';

-- 행이 없던 경우 대비 (047에서 생성되므로 정상적으로는 update 1건)
insert into public.system_settings (key, value)
values ('weekly_report_hierarchy_enabled', 'true')
on conflict (key) do update set value = 'true';
