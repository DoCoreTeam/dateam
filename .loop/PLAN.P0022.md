# PLAN newAX: 구성원 상세에서 계정을 고친다
플랜 ID: P0022
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0024
목표 버전: v0.10.137
작성: 2026-09-19
시작 커밋: febc514d

## 목표
- 구성원 상세에서 이름 직급 직책 역할 소속을 그 자리에서 고침, 목록으로 되돌아갈 일이 없음
- 고치는 중에는 저장과 취소가 보임 (수정 단추가 저장으로 바뀜)
- PW 초기화 온보딩 초기화 퇴사 처리 삭제를 상세에서도 함, 목록 행에 있는 것이 상세에 없지 않음

## 범위 밖
- 이메일 주소 바꾸기 (로그인 계정 자체를 바꾸는 일이라 따로 잡아야 함)
- 조직도 구조 편집 (상위 조직을 만들거나 지우는 일은 조직도 관리 탭에서)
- 여러 명 한꺼번에 고치기

## 완료 정의
- pnpm tsc --noEmit, pnpm test 통과
- 사용자 노출 문자열은 lib/terms 상수 사용
- 목록 행의 관리 메뉴에 있는 조작이 상세에도 전부 있음 (대조표를 감사에 적음)
- 브라우저에서 이름 직급 직책 역할 소속을 고쳐 저장하면 새로고침 뒤에도 남음

## 참조
- .loop/archive/P0019-v0.10.98-퇴사-처리와-구성원-상세.md I05 (읽기 전용으로 만들었던 항목)
- apps/web/app/admin/users/UserTable.tsx 의 RowActions 묶음 (상세가 맞춰야 할 기준)

## 항목

### I01 소속을 상세에서 바꾸는 서버 동작
상태: 통과
모드: 중량
범위: apps/web/app/admin/users/actions.ts
감사 기준:
- setMemberDepartment(userId, nodeId) 가 사람 노드를 만들거나 옮기거나 떼어 냄
- 조직도에 없던 사람을 부서에 넣으면 노드가 생김 (psql 대조)
- 소속 없음으로 두면 노드가 사라짐
- admin 이 아니면 거부
의존: 없음

### I02 계정 카드를 고칠 수 있게
상태: 통과
모드: 경량
범위: apps/web/app/admin/members/[id]/MemberFacts.tsx, apps/web/app/admin/members/[id]/page.tsx
감사 기준:
- 수정을 누르면 이름 직급 직책 역할 소속이 입력칸이 되고 저장과 취소가 보임
- 저장 후 새로고침해도 값이 남음 (브라우저 실측)
- 취소하면 고치기 전 값으로 돌아감
- 이메일 가입일은 읽기 전용으로 남음
의존: I01

### I03 계정 조작을 상세에도
상태: 대기
모드: 경량
범위: apps/web/app/admin/members/[id]/MemberActions.tsx (신규), apps/web/app/admin/members/[id]/page.tsx, apps/web/e2e/member-detail-edit.spec.ts (신규)
감사 기준:
- 상세에 PW 초기화 온보딩 초기화 퇴사 처리(또는 취소) 삭제가 있음
- 목록 행 관리 메뉴의 조작과 상세의 조작이 같은 묶음임 (빠진 것 0개)
- 자기 자신에게는 역할 바꾸기 퇴사 삭제가 안 보임
의존: I02

### I04 판 번호
상태: 대기
모드: 경량
범위: package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- 다섯 파일의 판 번호가 같고 커밋 직전 다시 계산한 다음 패치임
- node --test lib/policy/policy-sync.test.ts lib/policy/version-rule.test.ts 통과
의존: I03

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-19) 최초 작성 (ins_0024)
