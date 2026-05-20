# FAST PATH Summary
작업: 어드민 주간보고 취합 / KPI 집계 페이지에서 보고서가 0건으로 나타나는 버그 수정
대상: apps/web/app/admin/reports/page.tsx, apps/web/app/admin/kpi/page.tsx
이유: profiles_select RLS 정책의 재귀 EXISTS 서브쿼리가 profiles!inner(name) JOIN 시 타 유저 프로필을 차단하여 보고서가 보이지 않음. createAdminClient()로 변경하여 서비스롤 키로 RLS 우회
영향: 두 어드민 페이지 데이터 조회만 영향. auth 체크는 createClient() 유지. 멤버 페이지 무영향
