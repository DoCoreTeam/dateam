# 00 요구사항 — 업무체계 재설계 + 전영역 임시저장/Undo (구현)
기획 출처: docs/2026-06-16-work-grouping-dashboard-plan/ (00·01). 사용자 확정: UI 풀진행 / 부서=일일행 참조승격 / 프로젝트=deals 재사용.
## 구성
- A. 일일=캡처/부서=승격: 일일 API(logs·week·carryover)+getDailyLogs에 task_kind='personal' 필터(부서 역류 제거). 일일→부서 승격(daily 행 참조 링크, 복제X).
- B. 그룹핑 뷰: 고객(accounts)/딜(deals) 축 group-by(work_entity_links·linked_account_id). 링크없는 일일 AI 후보 제안(autolink 재사용).
- C. 워크로드 대시보드: 관여분포·그룹별 진행·활동추세(건수/비중).
- D. 전영역 임시저장(새로고침 유지)+Ctrl+Z: useFormCore 단일 훅, 모든 입력면 적용. 민감정보 제외.
## 비기능
Playwright E2E + 실데이터/계정 검증. 기존 부서/주간 회귀0. RLS. tsc0/design. git push 금지.
