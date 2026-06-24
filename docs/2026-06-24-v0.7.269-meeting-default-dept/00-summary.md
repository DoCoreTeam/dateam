# v0.7.269 — 새 회의노트 부서 기본값 = 작성자 본인 부서

작업: 새 회의노트 폼의 "부서" 필드가 비어있어 매번 수동 선택해야 함 → 작성자 본인 소속 부서로 자동 기본값.
대상:
- `apps/web/app/(member)/meeting-notes/actions.ts` — `getMyDefaultDepartmentId()` 서버액션 추가(본인 person 노드의 가장 가까운 department 조상, 폴백=본인이 head인 부서). org-scope SSOT 재사용.
- `apps/web/app/(member)/meeting-notes/MeetingEditor.tsx` — create 모드 & 부서 미지정일 때 본인 부서를 기본 선택(목록에 존재할 때만, 사용자 선택 우선).
이유: 대부분 본인 부서 회의라 매번 선택은 불필요한 마찰.
영향: 수정 모드/기존 노트 무영향(create + 미지정만). 부서 목록(org_nodes type=department)에 본인 부서가 있어야 적용 — 없으면 기존대로 '부서 없음'.
