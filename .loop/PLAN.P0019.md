# PLAN newAX: 퇴사 처리와 구성원 상세
플랜 ID: P0019
플랜 버전: v0.2.3
상태: 진행중
지시: ins_0021
목표 버전: v0.10.98
작성: 2026-09-17
시작 커밋: 8ecafccc

## 목표
- 구성원이 회사를 떠나면 「퇴사」 한 번으로 그 사실이 남고, 그 사람이 남긴 일일업무 주간보고 회의노트는 그대로 남음
- 구성원 목록과 조직도 어디서 사람을 누르든 같은 구성원 상세가 열리고, 거기서 입사일 퇴사일 퇴사 사유를 고침
- 조직을 지울 때 붙어 있는 기록을 어디로 옮길지 물어보고 옮긴 뒤 지움 (지금은 외래키에 막혀 아예 안 지워짐)
- 퇴사한 사람은 로그인하지 못하고 담당자 참석자 같은 사람 고르는 자리에 뜨지 않음

## 범위 밖
- 입사일 일괄 채우기 (지금 알 수 없어 빈칸으로 두고 상세에서 하나씩 채움)
- 연차 급여 평가 같은 인사 정보 전반
- 소유를 사용자로 옮겨 부서 권한을 사용자 소속에서 끌어오는 재설계 (표 열세 개의 department_id 를 전부 걷어내는 일이라 따로 잡아야 함)
- 재직 기간을 근거로 한 통계 화면

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 lib/terms 상수 사용
- 설정값 추가 없음 (env 신규 없음)
- 퇴사 처리 뒤에도 그 사람의 profiles 행과 일일업무 주간보고 행이 그대로 있음 (psql 건수 대조)
- 실브라우저에서 퇴사 처리와 되돌리기가 동작함

## 참조
- LOOP.md 부록 버전 규칙
- apps/web/app/admin/users/actions.ts 의 deleteUser (소프트 삭제 + 조직도 정리 + auth ban 선례)
- docs/ui-system/GLOSSARY.md 용어집

## 항목

### I01 표 신설 member_employment
상태: 통과
모드: 중량
범위: supabase/migrations/255_member_employment.sql (신규), apps/web/types/database.ts
감사 기준:
- PGPASSWORD=... ./scripts/migrate.sh 255_member_employment.sql 가 성공하고 --status 에 255 가 적용됨으로 뜸
- psql 로 member_employment 에 컬럼 user_id hired_on resigned_on resign_reason 존재 확인
- pnpm tsc --noEmit 통과
의존: 없음

### I02 재직 상태 부품과 용어
상태: 통과
모드: 경량
범위: apps/web/lib/members/employment.ts (신규), apps/web/lib/members/employment.test.ts (신규), apps/web/lib/terms/member.ts (신규), apps/web/lib/terms/index.ts, apps/web/package.json
감사 기준:
- node --test --experimental-strip-types lib/members/employment.test.ts 통과
- pnpm test 총 테스트 수가 등재 전보다 늘어남 (등재했는데 안 도는 것 방지)
- 화면이 쓸 문자열 퇴사 재직 입사일 퇴사일이 lib/terms 에만 있음
의존: I01

### I03 서버 동작 퇴사 되돌리기 입사퇴사 수정
상태: 통과
모드: 중량
범위: apps/web/app/admin/users/employment-actions.ts (신규), apps/web/app/admin/users/actions.ts
감사 기준:
- admin 이 아닌 사용자가 부르면 관리자 권한 문구를 돌려줌 (코드 경로 확인)
- 자기 자신 퇴사는 거부됨
- 퇴사 시 auth ban 이 걸리고 profiles 행은 삭제되지 않음 (psql 대조)
- 되돌리기 시 ban 이 풀리고 resigned_on 이 비워짐
의존: I02

### I04 목록에 퇴사 표시와 퇴사 단추
상태: 통과
모드: 경량
범위: apps/web/app/admin/users/UserTable.tsx, apps/web/app/admin/users/ResignButton.tsx (신규), apps/web/app/admin/members/page.tsx
감사 기준:
- 퇴사한 구성원 이름 옆에 퇴사 배지가 보임
- 재직 여부 거르개가 목록에 붙고 기본은 전체다 (사용자가 목록에서 퇴사 표시를 보고 싶다고 했으므로 숨기지 않는다)
- 행을 누르면 /admin/members/<id> 로 감
- 관리 메뉴에 퇴사 단추가 있고 퇴사자에게는 되돌리기로 바뀜
의존: I03

### I05 구성원 상세 화면
상태: 통과
모드: 경량
범위: apps/web/app/admin/members/[id]/page.tsx (신규), apps/web/app/admin/members/[id]/EmploymentCard.tsx (신규), apps/web/app/admin/members/[id]/MemberFacts.tsx (신규)
감사 기준:
- /admin/members/<id> 가 이름 이메일 직급 직책 역할 가입일을 보여 줌
- 같은 화면에서 입사일 퇴사일 퇴사 사유를 고쳐 저장하면 값이 남음
- admin 이 아니면 들어갈 수 없음
의존: I04

### I06 조직도에서 사람 카드를 누르면 구성원 상세
상태: 통과
모드: 경량
범위: apps/web/app/admin/org-chart/OrgNodeCard.tsx, apps/web/app/admin/org-chart/OrgNodeModals.tsx, apps/web/app/admin/org-chart/OrgTree.tsx
감사 기준:
- 조직도에서 사람 카드를 누르면 /admin/members/<user_id> 로 감
- 사람 노드의 연필은 「노드 수정」이 아니라 「부서 이동」이고 상위 노드 변경만 보임 (지금은 제목이 노드 수정인데 안에 상위 노드 변경 하나뿐이라 무엇을 하는 창인지 알 수 없음)
- 드래그로 옮기는 동작이 그대로 됨 (카드 누르기가 드래그를 잡아먹지 않음)
의존: I05

### I07 조직 삭제 이관 RPC
상태: 통과
모드: 중량
범위: supabase/migrations/256_org_node_delete_transfer.sql (신규)
감사 기준:
- PGPASSWORD=... ./scripts/migrate.sh 256_org_node_delete_transfer.sql 성공, --status 에 256 적용됨
- org_node_impact(uuid) 가 org_nodes 를 가리키는 표별 건수를 돌려줌 (calendar_events daily_logs meeting_notes weekly_reports weekly_report_items weekly_report_activity weekly_report_snapshots report_access_log dept_weekly_reports projects 하위 노드)
- org_node_delete_transfer(uuid, uuid) 가 한 트랜잭션에서 옮기고 지움, 대상이 자기 자신이나 자기 자손이면 예외
- psql 로 기록이 붙은 조직에 대해 이관 후 건수가 대상 조직으로 그대로 옮겨짐 (합계 불변)
의존: 없음

### I08 조직 삭제 대화상자 영향 미리보기와 이관 대상 선택
상태: 대기
모드: 경량
범위: apps/web/app/admin/org-chart/actions.ts, apps/web/app/admin/org-chart/DeleteNodeModal.tsx (신규), apps/web/app/admin/org-chart/OrgTree.tsx
감사 기준:
- 기록이 붙은 조직의 휴지통을 누르면 표별 건수와 이관 대상 고르는 칸이 보임
- 대상을 안 고르면 삭제 단추가 눌리지 않음
- 실브라우저에서 기록 붙은 조직이 실제로 지워지고 calendar_events 외래키 오류가 안 뜸
- 기록이 0건이면 물어보지 않고 바로 지움
의존: I07

### I08a 조직도 트리 레벨 정렬
상태: 대기
모드: 경량
범위: apps/web/app/admin/org-chart/OrgTree.tsx, apps/web/app/(member)/org/OrgTreeView.tsx
감사 기준:
- 같은 깊이의 노드(성장지원본부 AX사업본부 CTO 운영/마케팅본부 글로벌사업본부)의 카드 윗변 y 좌표가 같음 (브라우저에서 getBoundingClientRect 로 대조)
- CTO 아래 연구소 개발본부가 다른 본부의 하위 부서와 같은 줄에 놓임
- 자식 수가 다른 형제 때문에 줄이 밀리지 않음 (한 깊이 = 한 줄)
- 접기 펼치기와 드래그가 그대로 동작함
의존: 없음

### I09 퇴사자를 사람 고르는 자리에서 뺀다
상태: 대기
모드: 경량
범위: apps/web/app/(member)/org/page.tsx, apps/web/app/(member)/work/projects/[id]/page.tsx, apps/web/app/admin/kpi/page.tsx, apps/web/app/api/crm/members/route.ts, apps/web/lib/members/active-members.test.ts (신규)
감사 기준:
- 위 네 자리가 전부 lib/members 의 거르개를 지남
- node --test 로 거르개 정적 가드 통과 (from('profiles') 로 여러 명을 읽는 고르는 자리가 거르개를 안 지나면 실패)
- pnpm tsc --noEmit 통과
의존: I08

### I10 판 번호와 업데이트 내역
상태: 대기
모드: 경량
범위: package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md, apps/web/lib/changelog/entries.ts
감사 기준:
- 여섯 파일의 판 번호가 같고 커밋 직전 다시 계산한 다음 패치임
- node --test lib/policy/policy-sync.test.ts lib/policy/version-rule.test.ts 통과
의존: I09

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-17) 최초 작성 (ins_0021)
- v0.2.0 (2026-09-17) 조직 삭제 이관과 조직도 사람 카드 항목 추가 (ins_0022 ins_0023)
- v0.2.1 (2026-09-17) I08a 조직도 트리 레벨 정렬 추가, 같은 깊이가 같은 줄에 안 놓여 CTO 와 본부들이 어긋나 보임 (ins_0024)
- v0.2.3 (2026-09-17) I04 거르개 기본값을 재직에서 전체로 고침, 지시가 목록에서 퇴사 표시를 보는 것이었다
- v0.2.2 (2026-09-17) 조직도 트리에서 같은 깊이 노드가 같은 줄에 안 놓여 CTO 와 본부 레벨이 어긋나 보임, I08a 로 한 깊이 한 줄 격자 정렬 항목 추가 (iv_0024)
- v0.2.3 (2026-09-17) I04 거르개 기본값을 재직에서 전체로 고침, 지시는 목록에서 이름 옆 퇴사 표시를 보는 것이라 기본에서 숨기면 안 됨 (audit:I04)
