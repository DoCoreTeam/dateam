# 01 아키텍처
## A 역류제거+승격
- daily 조회 경로 전부 personal 한정: api/daily/{logs,week,carryover}/route.ts + actions.getDailyLogs. 부서업무 화면은 기존대로 task_kind='dept_task'.
- 승격: work_promotions(또는 work_entity_links 재사용) — 일일 log_id → dept_task(daily_logs task_kind=dept_task) 참조 생성. 복제 금지, 원본 유지. 기존 DeptTaskSuggestPanel 패턴 재사용.
## B 그룹핑
- group-by 축: account(linked_account_id|work_entity_links kind=account), deal(work_entity_links kind=deal). API: /api/work/groups?by=account|deal → 그룹별 집계+로그. 링크없는→AI 후보(autolink GET/run).
## C 대시보드
- /api/work/dashboard: 관여분포(그룹별 count), 그룹진행(entry_type 롤업), 추세(주별 count). UI 위젯 3종, 토큰만.
## D 임시저장+undo
- lib/forms/useFormCore.ts: useDraft(localStorage, key=draft:v1:{uid}:{formId}:{recordId}, 디바운스·복원배너·submit clear·TTL·민감exclude) + useUndoable(스냅샷 past/present/future, maxHistory) + 단축키(Cmd/Ctrl+Z, Shift redo, IME·Tiptap·포커스 스코프). 마운트후 복원(SSR안전).
