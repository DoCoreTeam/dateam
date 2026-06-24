# v0.7.272 — 조직원 피커 트리에 부서장·C레벨 포함

작업: OrgPeoplePicker 트리가 `type='person'`(구성원)만 선택 가능해서, `head_user_id`로만 연결된 **부서장·본부장·C레벨(대표이사·CTO)**이 트리에서 누락되던 결함 수정.
대상:
- `apps/web/lib/org/picker-types.ts` — OrgPickerNode에 `head_user_id` 추가
- `apps/web/app/(member)/meeting-notes/actions.ts` — getOrgTreeForPicker가 head_user_id select·반환
- `apps/web/components/ui/OrgPeoplePicker.tsx` — 부서/역할 노드의 장을 트리에서 선택 가능한 행("장" 태그)으로 렌더, user_id 중복 방지(장이 구성원으로도 있으면 1회만)
- `apps/web/app/globals.css` — `.oap-person-hint`(장 태그)
이유: 조직 모델은 사람을 ①person 노드(user_id) ②부서/역할의 head_user_id 두 방식으로 연결. 첫 구현이 ①만 처리해 ② 누락(검색엔 전체 profiles라 떴으나 트리엔 안 뜸).

## 실데이터 검증
- 장 10명 전원 프로필 해소(트리 선택 가능). 그중 9명은 person 노드 없이 head로만 연결 → 기존 완전 누락분(이제 포함). 1명은 구성원과 겹쳐 dedup으로 1회 표시.

## 영향 / 검증
- 빈 브랜치 가지치기: 장이 있으면 헤더 유지(구성원 0인 부서도 장 표시).
- tsc clean · eslint clean · design:check 통과.
