# FAST PATH Summary — 주간보고 취합 부서장 누락 수정 + 어드민/멤버 취합 단일화

**작업:** 부서 취합 멤버 집합 산출 SSOT(`deptMemberUserIds`)에 `head_user_id`(부서장·본부장) 합집합을 통합하고, 어드민 취합(admin/reports)의 인라인 중복 쿼리를 동일 SSOT 재사용으로 교체해 어드민·멤버 두 취합 경로를 기능적으로 동일하게 만든다.

**대상:**
- `apps/web/lib/org-scope.ts` — `deptMemberUserIds()`에 서브트리 노드의 `head_user_id` 합집합 추가 (SSOT 단일 수정)
- `apps/web/app/admin/reports/page.tsx` — 인라인 closure→person 쿼리 폐기, `resolveOrgScope`+`deptMemberUserIds` 재사용
- `apps/web/app/(member)/dept-tasks/actions.ts` — SSOT가 head를 포함하므로 중복 head 우회 제거
- `apps/web/lib/org-scope.test.ts` — 부서장 포함 회귀 테스트 추가

**이유:** 부서장은 조직도에서 person 카드가 아니라 부서 노드의 `head_user_id`로만 연결된다. 기존 `deptMemberUserIds`는 `type='person'`만 산출해 부서장을 누락 → 조직 필터 조회 시 부서장만 빠지고 "전체"(필터 없음)에선 노출되는 불일치 발생. 어드민은 SSOT를 쓰지 않고 인라인 복붙해 같은 누락 + 멤버 화면과 로직 분기.

**영향:** 멤버 주간보고 조직현황 취합(`org-actions.ts:aggregateDept`, 멤버 org view readable 루프)은 SSOT 수정으로 자동 반영. 어드민 취합은 SSOT 전환으로 멤버와 결과 동일. dept-tasks 후보 목록은 동작 불변(중복 제거만). DB 스키마/UI 변경 없음.

**완료조건:**
- [ ] 조직 필터로 부서 조회 시 부서장 작성분이 노출된다 (멤버·어드민 동일)
- [ ] `deptMemberUserIds`가 person + subtree head_user_id 합집합을 중복 없이 반환
- [ ] 어드민 취합과 멤버 취합이 동일 부서·주차에서 동일 멤버 집합 사용 (SSOT 단일 경로)
- [ ] 회귀 테스트 통과 (head-only 부서장 포함 케이스)
