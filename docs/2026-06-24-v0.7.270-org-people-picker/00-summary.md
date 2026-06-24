# v0.7.270 — 조직원 추가: 드롭다운 → 검색·트리 모달 피커

작업: 회의노트 참석자의 "조직원 추가" `<select>` 드롭다운을 재사용 모달 피커로 교체(검색 + 조직도 트리 + 다중선택).
이유: 인원 많을 때 드롭다운 스크롤로 찾기 느림 → 검색·트리로 즉시 선택.

## 사용자 결정 (Q&A)
1. 다중 선택 후 한 번에 추가(체크박스).
2. 검색 = 전체 구성원(조직도 미배치 포함, 평면 profiles), 트리 = 조직도 배치 인원 — 선택은 합산(아무도 누락 안 됨).
3. 공용 컴포넌트 `components/ui/OrgPeoplePicker`로 신설하되 이번엔 회의노트만 연결.

## 변경 파일
- **신규** `apps/web/components/ui/OrgPeoplePicker.tsx` — 모달: 검색 입력(전체 people) + 조직도 트리(org_nodes 계층, person 리프 체크박스) + 다중선택 → "N명 추가". 이미 추가된 사람은 비활성+체크. 모달 표준(useEscClose·tape-title·광원형 shadow·backdrop rgba(15,23,42,0.5)).
- **수정** `apps/web/app/(member)/meeting-notes/actions.ts` — `getOrgTreeForPicker()` 서버액션(org_nodes id/type/parent_id/name/user_id/display_order, createClient=RLS 멤버 읽기).
- **수정** `apps/web/app/(member)/meeting-notes/AttendeesEditor.tsx` — `<select>`+추가 → "조직원 추가" 버튼이 OrgPeoplePicker 모달 오픈. tree prop 추가.
- **수정** `apps/web/app/(member)/meeting-notes/MeetingEditor.tsx` — getOrgTreeForPicker 로드 → AttendeesEditor에 tree 전달.
- **수정** `apps/web/app/globals.css` — picker 트리/행 스타일(토큰만).

## 데이터/식별
- 참석자 member id = profiles.id(= person.user_id). 트리 person 리프의 user_id로 선택, 표시명은 평면 people(profiles)에서 보정(없으면 node.name).
- person.user_id 없는(공석) 노드는 선택 불가.

## 완료 조건
- [ ] 검색으로 전체 구성원(미배치 포함) 필터·다중선택
- [ ] 트리로 조직도 계층 표시·person 리프 다중선택, 둘 다 선택 합산
- [ ] 이미 추가된 사람 중복 추가 차단(비활성+체크)
- [ ] 외부 참석자 입력 흐름 무변경
- [ ] 모달 표준 5종 충족 / tsc·design:check 통과 / DC-REV·DC-SEC APPROVED
- [ ] 공용 컴포넌트로 작성(다른 화면 재사용 가능 구조), 이번엔 회의노트만 연결

## 제외
- 부서업무 등 타 화면 연결, DB 변경, 권한 변경.
