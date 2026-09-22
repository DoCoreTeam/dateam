# PLAN newAX: 담당자와 작성자를 넣고 권한 기본값을 고친다
플랜 ID: P0054
플랜 버전: v0.1.5
상태: 진행중
지시: ins_0091
목표 버전: v0.10.402
작성: 2026-09-22
시작 커밋: e25e4fb6

## 목표
- 영업 CRM 의 모든 데이터에 담당자와 작성자가 붙고 화면에 보인다
- 메뉴를 열어 주면 쓸 수 있게 된다 (지금은 자동으로 보기만 으로 앉아 아무것도 못 쓴다)
- 내 담당을 가려 볼 수 있다 (지금은 어느 계정으로 들어와도 같은 목록이다)

## 범위 밖
- CRM 밖의 담당자 (일일업무 assignee 266건 중 6건, 프로젝트 항목) — 사람 표시 부품만 공용으로 만들고 화면 교체는 다음 판
- 공동 담당자와 협업자 — 담당자는 한 명이고 함께 보는 것은 권한 범위가 푼다
- 접근권한 표에 값이나 범위 칼럼을 더하는 것 — 범위는 조직도에서 계산하는 것이 SSOT 다
- 사라진 부여와 멤버 8명의 원인 규명 — 사용자에게 보고했고 인과가 확인되면 따로 잡는다

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 견적 승인이 권한 없는 사람에게 403 을 준다 (일부러 깨뜨려 확인)
- 접근권한으로 새로 앉는 사람이 멤버이고 그 사실이 변경 이력에 남는다
- 딜, 거래처, 고객 담당자에 작성자 칼럼이 있고 변경 이력에서 되찾을 수 있는 만큼 채워져 있다
- 새로 만들면 작성자와 담당자가 자동으로 붙는다
- 담당자가 비면 조직 상위가 대행으로 뜬다
- 목록과 오늘 화면에 내 담당 탭이 있고 계정마다 다른 목록이 나온다
- 못 하는 동작의 버튼이 안 그려진다

## 참조
- .loop/archive/P0046-v0.10.365-접근권한으로-메뉴를-연다.md (표면 판정과 자동 자리의 출처)
- apps/web/lib/access/capabilities.ts (권한과 범위의 이름, 여기서 복사하지 않고 읽는다)
- apps/web/lib/crm/security/sensitivity.ts (역할별 기본 권한)
- apps/web/lib/crm/services/member-title.ts (직책 고르는 규칙, 이미 있다)
- supabase/migrations/257_org_node_delete_transfer.sql (비우지 않고 옮기는 선례)

## 항목

### I01 견적 승인이 권한을 본다
상태: 통과
모드: 중량
범위: apps/web/lib/crm/auth/capabilities-gate.ts, apps/web/app/api/crm/quotes/[id]/approve/route.ts, apps/web/lib/crm/auth/capabilities-gate.test.ts (신규), apps/web/package.json
감사 기준:
- 보안 S2: 승인 창구가 quote.approve 권한을 확인한다. 권한 없는 역할이 부르면 CrmError FORBIDDEN 이 난다
- 보안 S2: 가드가 approveQuote 를 부르는 자리 전부가 관문도 부르는지 센다. 이름만 보지 않고 호출 자리를 본다
- 보안 S6: 권한 검사를 일부러 빼고 시험이 실패하는 것을 확인한 뒤 되돌린다. 확인한 사실을 pass --notes 에 적는다
- 새 시험이 apps/web/package.json 의 test 스크립트에 등재되고 pnpm test 총 건수가 실제로 는다
- pnpm tsc --noEmit 통과
의존: 없음

### I02 접근권한으로 앉는 사람이 멤버가 되고 이력에 남는다
상태: 통과
모드: 중량
범위: apps/web/app/admin/access/actions.ts, apps/web/lib/access/seat-role.ts (신규), apps/web/lib/access/auto-seat.test.ts (신규), apps/web/package.json
감사 기준:
- 보안 S2: 자동 생성 역할이 MEMBER 다. 이미 자리가 있으면 역할을 안 덮는다 (올려 둔 권한이 내려가지 않는다)
- 자리를 만들면 crm_audit_log 에 member.added 가 남는다. 지금은 한 줄도 안 남는다
- 가드가 자동 생성 경로에 READONLY 리터럴이 다시 들어오는 것을 잡는다. 일부러 되돌려 실패를 확인한다
- pnpm tsc --noEmit 통과
의존: 없음

### I03 작성자 칼럼 셋을 만들고 되찾을 수 있는 만큼 채운다
상태: 통과
모드: 중량
범위: supabase/migrations/278_crm_created_by.sql (신규), apps/web/prisma/schema.prisma
감사 기준:
- 보안 S1: 새 표를 만들지 않는다. 기존 세 표의 RLS 가 이미 켜져 있음을 psql 로 확인하고 결과를 적는다. 사본을 뜨지 않는다
- crm_company, crm_person, crm_deal 에 createdById 가 생긴다. 형과 규칙은 옆 표의 createdById 와 같다 (외래키 없는 TEXT, 이 저장소의 여덟 모델이 그렇다)
- 변경 이력의 company.created, person.created, deal.created 에서 백필한다. 채워진 건수를 적는다 (실측 기대값 딜 8, 회사 9, 사람 8)
- 헤더에 되돌리기 문장을 적는다
의존: 없음

### I04 새로 만들면 작성자와 담당자가 붙는다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/company.ts, apps/web/lib/crm/services/person.ts, apps/web/lib/crm/services/deal.ts, apps/web/lib/crm/services/task.ts, apps/web/lib/crm/services/created-by.test.ts (신규), apps/web/package.json
감사 기준:
- 만들 때 createdById 가 지금 멤버로 들어간다
- ownerId 기본값이 createdById 다. 만드는 쪽에서 다른 사람을 넘기면 그 값이 이긴다
- 고치는 길은 작성자를 안 건드린다 (normalizeInput 에 그 칸이 없다). 가드가 잠근다
- 기존 행은 하나도 안 바뀐다
- pnpm tsc --noEmit 통과
의존: I03

### I05 담당자 변경 권한을 만든다
상태: 통과
모드: 중량
범위: apps/web/lib/access/capabilities.ts, apps/web/lib/crm/security/sensitivity.ts, apps/web/lib/terms/access.ts, apps/web/lib/crm/auth/capabilities-gate.ts, apps/web/lib/crm/auth/capabilities.ts, apps/web/lib/crm/auth/capabilities-gate.test.ts, apps/web/lib/access/decide.test.ts
감사 기준:
- 보안: owner.reassign 이 권한 목록에 들고 역할 기본값은 OWNER 와 ADMIN 만이다. MEMBER 와 READONLY 는 없다
- 화면에 뜨는 이름이 lib/terms/access.ts 에 있다 (기존 다섯과 같은 자리)
- 모르는 문자열이 DB 에 있어도 권한으로 안 쳐지는 기존 걸름이 새 이름을 통과시킨다
- pnpm tsc --noEmit 통과
의존: 없음

### I06 담당자가 비면 조직 상위가 대행한다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/owner-fallback.ts (신규), apps/web/lib/crm/services/owner-fallback.test.ts (신규), apps/web/package.json
감사 기준:
- 담당자가 없거나 그 멤버가 나갔으면 그 사람 부서의 부서장을 돌려준다
- 부서장이 없거나 본인이면 상위로 올라가고 최상위는 대표다
- 조직에 안 걸린 사람이어도 안 멈춘다 (빈 값을 돌려주고 화면이 처리한다)
- 새 시험이 package.json 에 등재되고 pnpm test 총 건수가 는다
의존: 없음

### I07 담당자를 바꾸는 창구를 연다
상태: 대기
모드: 중량
범위: apps/web/lib/crm/services/owner.ts (신규), apps/web/app/api/crm/deals/[id]/owner/route.ts (신규), apps/web/lib/crm/services/owner.test.ts (신규), apps/web/package.json
감사 기준:
- 보안 S2: 본인 담당을 남에게 넘기는 것은 담당자면 통과, 남의 담당을 바꾸는 것은 owner.reassign 이 있어야 하고 권한 범위 밖이면 403
- 바꾸면 crm_audit_log 에 남는다 (누가 언제 누구에서 누구로)
- 딸린 할일과 견적을 같이 옮길지 인자로 받는다. 확정 견적은 기본이 안 옮김이다
- 새 시험이 package.json 에 등재된다
의존: I05

### I08 사람을 한 벌로 그린다
상태: 대기
모드: 경량
범위: apps/web/components/ui/Person.tsx (신규), apps/web/app/api/crm/members/route.ts, apps/web/app/(crm)/crm/members/MembersClient.tsx, apps/web/lib/ui/person.test.ts (신규), apps/web/package.json
감사 기준:
- 보안 S2 S3: 멤버 목록 GET 의 등급 판정을 그대로 둔다. 직책과 직급이 새로 실려 나가므로 서비스롤로 profiles 를 읽는 자리는 이미 멤버인 사람의 id 로만 조회한다. 없는 사람을 물어 있는지 없는지가 새지 않게 한다
- 이름 옆에 직책이 뜨고 직책이 없으면 직급이 뜬다. 둘 다 없으면 이름만이고 지어내지 않는다
- 고르는 규칙은 lib/crm/services/member-title.ts 의 pickTitle 을 부른다. 같은 규칙을 다시 적지 않는다
- 멤버 목록에 실제로 직책이 뜬다 (실측 기대값 34명 중 직급 32, 직책 11)
- 새 시험이 package.json 에 등재된다
의존: 없음

### I09 화면이 담당자와 작성자를 그린다
상태: 대기
모드: 경량
범위: apps/web/app/(crm)/crm/deals/[id]/DealDetail.tsx, apps/web/app/(crm)/crm/deals/DealsClient.tsx, apps/web/app/(crm)/crm/companies (목록)
감사 기준:
- 딜 상세에 담당자와 작성자가 뜬다. 작성자 옆은 수정 불가 표시이고 누르는 자리가 없다
- 담당자가 대행이면 대행 표시가 붙는다 (I06 판정을 읽는다)
- 작성자가 없는 행은 기록 없음 으로 뜬다. 지어내지 않는다
- pnpm tsc --noEmit 통과
의존: I04, I06, I08

### I10 목록과 오늘 화면이 내 담당을 먼저 보인다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/services/attention.ts, apps/web/app/api/crm/today/route.ts, apps/web/app/(crm)/crm/today/TodayClient.tsx
감사 기준:
- buildAttention 이 보는 사람을 받는다. 지금은 인자가 없어 워크스페이스 전체를 준다
- 오늘 화면 기본이 내 담당이고 계정을 바꾸면 목록이 달라진다 (실측)
- 권한 범위가 넓은 사람만 부서와 전체 탭이 보인다
- pnpm tsc --noEmit 통과
의존: I04

### I11 못 하는 동작의 버튼을 안 그린다
상태: 대기
모드: 중량
범위: apps/web/app/(crm)/crm/settings/page.tsx, apps/web/app/(crm)/crm/settings (카드 열둘), apps/web/lib/ui/write-permission.test.ts (신규), apps/web/package.json
감사 기준:
- 보안 S2: 화면에서 감추되 서버 판정은 그대로 둔다. 감추기만 하고 API 를 여는 일이 없다
- 설정 카드 열넷이 전부 권한을 받는다. 지금은 둘뿐이다
- 가드가 쓰기를 하는 클라이언트 부품이 권한을 안 받으면 잡는다. 새 부품을 하나 만들어 잡히는 것을 확인하고 지운다
- pnpm tsc --noEmit 통과
의존: 없음

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-22) 최초 작성 (ins_0091)
- v0.1.1 (2026-09-22) I01 관문을 서비스가 아니라 라우트에 붙인다, 기존 원가 관문과 같은 자리이고 호출처가 그 라우트 하나뿐이다. 대신 가드가 호출 자리를 센다 (audit:I01)
- v0.1.2 (2026-09-22) I02 에 lib/access/seat-role.ts 를 더한다. 등급을 actions.ts 리터럴로 두면 시험이 소스 글자를 찾는 수밖에 없고 그건 주석도 통과시킨다. 값으로 대조하려고 모듈로 뺀다 (audit:I02)
- v0.1.3 (2026-09-22) I03 에 prisma/schema.prisma 를 더하고 외래키 조건을 뺀다. 이 저장소의 createdById 는 여덟 모델 전부 외래키 없는 TEXT 라 여기만 걸면 같은 뜻의 칸이 표마다 다른 규칙을 갖는다 (audit:I03)
- v0.1.4 (2026-09-22) I04 에 가드 시험을 더한다. 값이 실제로 들어가는지와 고치는 길에 작성자가 없는지를 센다. 가드가 할일 SELECT 의 작성자 누락을 실제로 잡았다 (audit:I04)
- v0.1.5 (2026-09-22) I05 에 세 파일을 더한다. 개별 부여를 거르는 필터가 역할 기본값 기준이라 어느 역할도 기본으로 안 가진 권한은 개별로 줘도 조용히 버려진다 (지금은 우연히 안 터지고 팀장 전용 권한을 만드는 순간 터진다). 이름 등록부 기준으로 고치고 가드를 붙였다. 역할 능력표 스냅샷 시험도 의도한 값으로 갱신 (audit:I05)
