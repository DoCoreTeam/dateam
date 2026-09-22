# PLAN newAX: 접근권한으로 메뉴를 연다
플랜 ID: P0046
플랜 버전: v0.2.0
상태: 진행중
지시: ins_0059
목표 버전: v0.10.365
작성: 2026-09-20
시작 커밋: d6b032ea

## 목표
- 관리자가 화면에서 메뉴 접근권한을 사용자·조직·혼합으로 열고 닫을 수 있게 한다
- 새 화면을 만들면 메뉴와 접근권한 화면에 저절로 등재되고, 빠뜨리면 테스트가 실패한다
- 열되 내보내기는 막기처럼 세부 조건을 걸 수 있게 한다

## 범위 밖
- 화면 게이트 전수 교체 (기본값이 관리자인 표면은 지금의 requireAdmin 과 동치라 그대로 둔다)
- CRM·CI·제안서 서비스 내부 역할 체계 (문 여닫기만 새 표가 맡고 내부 역할은 기존 표가 계속 맡는다)
- P0045 가 쓰는 파일 전부 (견적 비고, prisma/schema.prisma, 마이그 276)

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 부여가 0건일 때 관리자와 일반 사용자가 보는 메뉴가 지금과 동일하다
- 새 화면 경로를 등재하지 않으면 lib/policy 가드가 실패한다
- 접근권한 화면에서 부서·사람 부여를 저장하면 그 사람의 사이드바와 전체 메뉴가 함께 바뀐다
- 설정값은 env 추가 없이 DB 저장과 UI 관리

## 참조
- 기획 보고 https://claude.ai/code/artifact/f818b9ce-8eba-4325-ae90-4e99a234ff57
- LOOP.md 7절 보안 기준
- lib/policy/api-auth-surface.test.ts (경로 전수 대조 가드의 기존 패턴)
- lib/crm/security/sensitivity.ts (값 축의 기존 구현)

## 항목

### I01 안 열리는 문이 이유를 말한다
상태: 통과
모드: 경량
범위: apps/web/components/ui/AccessDenied.tsx (신규), apps/web/app/(member)/accounts/layout.tsx, apps/web/app/(member)/contacts/layout.tsx, apps/web/app/(member)/deals/layout.tsx, apps/web/app/(member)/lead-intake/layout.tsx, apps/web/app/(ci)/ci/page.tsx
감사 기준:
- 일반 사용자가 /accounts 로 가면 홈으로 튕기지 않고 그 주소에서 사유 안내가 뜬다 (grep 으로 requireAdmin 호출 0건, AccessDenied 렌더 확인)
- 워크스페이스가 없는 사용자가 /ci 로 가도 자기 자신으로 되돌리지 않는다 (redirect('/ci') 호출 0건)
- pnpm tsc --noEmit 통과
의존: 없음

### I02 표면 등재부와 판정 함수를 만든다
상태: 통과
모드: 경량
범위: apps/web/lib/access/surfaces.ts (신규), apps/web/lib/access/decide.ts (신규), apps/web/lib/access/decide.test.ts (신규), apps/web/package.json
감사 기준:
- pnpm test 에서 decide 테스트가 실제로 돈다 (등재 후 총 테스트 수가 늘어난 것을 확인)
- 판정 순서가 관리자 통과, 차단, 사용자, 조직, 기본값 순임을 각각 단정한다
- 등재부의 기본값이 지금의 NAV_AUDIENCE 와 ADMIN_ONLY_GROUPS 와 같은 결과를 낸다
의존: 없음

### I03 등재를 빠뜨리면 테스트가 실패한다
상태: 통과
모드: 경량
범위: apps/web/lib/policy/access-surface.test.ts (신규), apps/web/lib/access/surfaces.ts, apps/web/package.json
감사 기준:
- app 아래 page.tsx 전수를 걸어 표면에 안 붙는 경로가 있으면 실패한다
- 표면 한 줄을 지운 판으로 일부러 깨뜨려 실패를 확인하고 되돌린다
- 면제 목록에는 사유가 함께 적혀 있다
의존: I02

### I04 메뉴가 등재부에서 나온다
상태: 통과
모드: 경량
범위: apps/web/lib/nav/menu.ts, apps/web/app/(member)/layout.tsx, apps/web/components/ui/QuickNav.tsx, apps/web/lib/nav/menu.test.ts, apps/web/lib/ui/nav-standard.test.ts, apps/web/lib/ai-chat/nav/groups.test.ts, apps/web/lib/rfp/rfp-guard.test.ts
감사 기준:
- 사이드바와 전체 메뉴의 항목이 등재부에서 생성된다 (손목록 상수 제거 확인)
- 관리자와 일반 사용자가 보는 메뉴가 이 판 앞뒤로 동일하다 (테스트로 목록을 대조)
- 손목록을 보던 가드 넷이 새 구조를 보도록 옮겨지고, 옮긴 뒤에도 일부러 깨뜨려 실패를 확인한다
- pnpm test 통과
의존: I02

### I05 부여를 담을 표를 만든다
상태: 통과
모드: 중량
범위: supabase/migrations/277_access_control.sql (신규)
감사 기준:
- 보안: 두 표 모두 같은 마이그레이션에서 RLS 를 켠다 (rowsecurity=true 를 psql 로 확인)
- 보안: 정책 대상에 TO public 을 쓰지 않는다, 쓰기는 관리자만, anon 권한 0
- 마이그레이션 적용 후 기존 행이 하나도 안 바뀐다 (새 표만 생성, 기존 표 변경 없음)
의존: I02

### I06 부여를 읽되 화면은 그대로다
상태: 통과
모드: 경량
범위: apps/web/lib/access/load.ts (신규), apps/web/lib/access/load-pure.ts (신규), apps/web/lib/access/load.test.ts (신규), apps/web/package.json
감사 기준:
- 부여가 0건이면 decideAccess 가 I04 직후의 사이드바 목록을 관리자·일반 각각 그대로 낸다
- 화면 파일이 하나도 안 바뀐다 (git status 로 확인, 메뉴를 판정에 물리는 것은 I08)
- 한 번 부를 때 부여 조회가 정확히 1회이고, 내보내는 함수가 getRequestProfile 과 같은 요청 캐시로 싸여 있다
- pnpm test 통과
의존: I04, I05

### I07 관리자가 화면에서 연다
상태: 통과
모드: 중량
범위: apps/web/app/admin/access/page.tsx (신규), apps/web/app/admin/access/AccessClient.tsx (신규), apps/web/app/admin/access/actions.ts (신규), apps/web/app/api/admin/access/route.ts (신규), apps/web/app/admin/layout.tsx, apps/web/lib/terms/access.ts (신규), apps/web/lib/terms/index.ts, docs/ui-system/GLOSSARY.md
감사 기준:
- 보안: 창구가 requireAdminApi 를 부른다, 비관리자 호출이 403 을 받는다
- 보안: 주체 id 와 표면 키를 등재부와 대조해 모르는 값은 저장하지 않는다
- 표면에 부서를 붙이고 저장하면 그 부서 사람 수가 미리보기 숫자와 일치한다
- 미등재 표면 수가 화면 위에 뜬다
의존: I06

### I07a 이름 없는 표면이 주소로 뜨지 않는다
상태: 통과
모드: 경량
범위: apps/web/lib/nav/menu.ts, apps/web/lib/nav/menu.test.ts
감사 기준:
- 등재부의 모든 표면이 NAV_LABEL 에 이름을 갖는다 (가드가 전수로 대조하고, 한 줄을 지워 실패를 확인한다)
- 사이드바와 전체 메뉴 목록이 이 판 앞뒤로 동일하다 (배치에 없는 표면만 이름이 느는 것이라 목록은 안 바뀐다)
- 접근권한 화면에 주소가 이름 자리에 뜨는 줄이 0개다
의존: I07

### I08 숨기는 것과 막는 것이 같은 판정을 쓴다
상태: 통과
모드: 중량
범위: apps/web/lib/access/guard.ts (신규), apps/web/app/(member)/layout.tsx, apps/web/components/ui/shell/AppShell.tsx, apps/web/components/ui/QuickNav.tsx, apps/web/app/(member)/accounts/layout.tsx, apps/web/app/(member)/contacts/layout.tsx, apps/web/app/(member)/deals/layout.tsx, apps/web/app/(member)/lead-intake/layout.tsx
감사 기준:
- 보안: 메뉴에서 숨긴 표면은 주소를 직접 쳐도 막힌다, 관리자는 항상 통과한다
- 부여를 받은 일반 사용자의 사이드바와 전체 메뉴에 그 표면이 함께 나타난다
- 안 열린 표면은 전체 메뉴에서도 사라진다 (죽은 문 0개)
의존: I07

### I09 표면 안의 자리를 가른다
상태: 통과
모드: 경량
범위: apps/web/lib/access/surfaces.ts, apps/web/lib/access/decide.ts, apps/web/lib/access/decide.test.ts, apps/web/lib/access/guard.ts, apps/web/app/admin/access/actions.ts, apps/web/app/admin/access/AccessClient.tsx, apps/web/lib/terms/access.ts, apps/web/lib/terms/action.ts, docs/ui-system/GLOSSARY.md
감사 기준:
- 하위 경로는 등재부를 안 보고 구역 키가 된다 (zoneKeyOf('/work/activity') = 'work:activity'), 경로가 아닌 탭은 주소로 못 찾으므로 등재부에 탭 값을 적은 것만 구역이 된다
- 구역을 안 건드린 부여는 표면 값이 그대로 내려간다 (구역 부여가 0건이면 판정 결과가 이 판 앞뒤로 같다)
- 구역 하나를 막으면 그 주소만 막히고 같은 표면의 다른 자리는 열려 있다
- 부여할 수 있는 구역은 등재된 것뿐이다 (DB 사본에 행이 서야 외래키가 선다, 모르는 구역 키는 저장되지 않는다)
- 여닫는 말이 시스템 용어다 (허용·차단), 「막기」가 금지어 표에 들어가고 가드가 재유입을 막는다
- pnpm test 통과
의존: I08

### I10 동작을 가르고 내보내기를 잠근다
상태: 통과
모드: 중량
범위: apps/web/lib/access/actions.ts (신규), apps/web/lib/access/decide.ts, apps/web/lib/access/decide.test.ts, apps/web/lib/access/guard.ts, apps/web/lib/policy/export-gate.test.ts (신규), apps/web/app/api/crm/export/route.ts, apps/web/lib/crm/api/handler.ts, apps/web/lib/terms/access.ts, apps/web/app/admin/access/actions.ts, apps/web/app/admin/access/AccessClient.tsx, apps/web/package.json
감사 기준:
- 보안: 내보내기 라우트가 동작 판정을 부른다, 권한 없는 사용자가 403 을 받는다
- 보안: 내보내기 판정을 안 부르는 내보내기 라우트가 **새로 생기면** 가드가 실패한다, 일부러 깨뜨려 확인한다. 지금 안 붙은 창구는 사유와 함께 적고 수가 늘지 않게 잠근다
- 보기만 받은 사람은 CRM 쓰기 창구에서 403 을 받는다 (withCrmApi 가 쓰기 등급을 요구할 때 동작 판정도 함께 묻는다)
- 동작 부여가 0건이면 판정 결과가 이 판 앞뒤로 같다
의존: I09

### I10a 남은 내보내기 창구에도 판정을 붙인다
상태: 통과
모드: 중량
범위: apps/web/app/api/reports/export/route.ts, apps/web/app/api/reports/export-preview/route.ts, apps/web/app/api/meeting-notes/[id]/export/route.ts, apps/web/app/api/rfp/cases/[id]/export/route.ts, apps/web/app/api/admin/ai-chat/export/route.ts, apps/web/app/api/admin/ai-chat/export-pdf/route.ts, apps/web/app/api/admin/ai-chat/analyze-export-pdf/route.ts, apps/web/lib/policy/export-gate.test.ts
감사 기준:
- 보안: 일곱 창구가 각각 자기 표면의 내보내기 판정을 부른다, 권한 없는 호출이 403 을 받는다
- 보안: 가드의 「아직 안 붙은 창구」 목록이 0이 되고, 그 뒤로는 새 창구가 하나라도 안 부르면 실패한다
- 부여가 0건일 때 일곱 창구의 응답이 이 판 앞뒤로 같다
의존: I10

### I11 값과 범위를 가른다
상태: 통과
모드: 경량
범위: apps/web/lib/access/capabilities.ts (신규), apps/web/lib/access/decide.test.ts, apps/web/lib/crm/security/sensitivity.ts, apps/web/app/admin/access/actions.ts, apps/web/app/admin/access/AccessClient.tsx, apps/web/lib/terms/access.ts
감사 기준:
- CRM 능력 5종이 전사 표준 이름으로 올라온다 (CRM 이 새 SSOT 를 import 하고 목록을 두 벌로 안 든다), CRM 쪽 판정 결과가 바뀌지 않는다
- 범위 셋(내 것, 부서, 전사)이 조직 스코프 결과와 일치한다 (전사는 모든 부서, 부서는 관할 서브트리, 내 것은 관할 없음)
- 관리자 화면이 사람마다 그 사람의 범위를 보여 준다 — 열어 주면 무엇까지 보는지 저장 전에 알 수 있어야 한다
- pnpm test 통과
의존: I10

### I11a 부여가 서비스 문까지 연다
상태: 통과
모드: 중량
범위: apps/web/app/(crm)/layout.tsx, apps/web/app/(ci)/layout.tsx, apps/web/app/(ai)/layout.tsx, apps/web/app/(rfp)/layout.tsx, apps/web/lib/access/surfaces.ts, apps/web/app/admin/access/actions.ts, apps/web/app/admin/access/AccessClient.tsx, apps/web/lib/terms/access.ts
감사 기준:
- 보안: 서비스 셸 넷이 접근권한 판정을 부른다, 부여를 지우면 주소를 쳐도 막힌다
- 영업 CRM 을 사람에게 허용하면 그 사람이 실제로 들어간다 (부여 저장이 CRM 멤버 자리를 함께 만든다, 실브라우저로 확인)
- 아직 못 여는 서비스는 화면이 그 이유를 말한다 (조용히 안 열리지 않는다)
- 부여가 0건일 때 서비스 넷의 동작이 이 판 앞뒤로 같다
의존: I11

### I12 첫 부여를 넣고 전체를 잰다
상태: 대기
모드: 중량
범위: apps/web/app/admin/access/AccessClient.tsx, .loop/PLAN.P0046.md, apps/web/lib/changelog/entries.ts, package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- 보안: LOOP.md 7절 기계가 세는 것 다섯 줄을 실행해 전부 0 임을 기록한다
- 제안서를 전체 공개로, CRM 을 두 부서에 연 상태에서 일반 사용자 화면을 실제로 확인한다
- 사용자 체감 변경이 업데이트 내역에 적힌다
의존: I11

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-20) 최초 작성 (ins_0059)
- v0.1.2 (2026-09-21) I04 범위에 nav-standard.test.ts 와 ai-chat/nav/groups.test.ts 를 넣었다, 메뉴 항목을 등재부 생성으로 바꾸면 손목록 글자를 찾던 단정 넷이 같은 판에서 깨져 나눌 수 없다 (audit:I04)
- v0.1.3 (2026-09-21) I04 범위에 rfp-guard.test.ts 를 더했다, 전체 메뉴에서 href 글자를 찾던 단정이 하나 더 있었고 pnpm test 전체를 돌려서야 드러났다 (audit:I04)
- v0.1.4 (2026-09-21) I06 에서 layout.tsx 를 빼고 I08 로 옮겼다, 읽어만 두고 안 쓰는 값을 레이아웃에 넣으면 죽은 코드이고 메뉴를 판정에 물리는 판은 I08 이다. 그리고 전체 메뉴는 지금 죽은 문 넷을 그리고 있어 0건 부여로도 I04 와 같을 수 없다, 그 차이를 없애는 것이 I08 의 감사 기준이라 여기서는 사이드바만 대조한다 (audit:I06)
- v0.1.5 (2026-09-21) I06 범위에 load-pure.ts 를 더했다, lib/supabase/server 가 server-only 를 달고 있어 load.ts 를 그대로 import 하면 node 시험 러너가 해석하지 못한다, org-scope 가 같은 이유로 org-scope-pure 를 두고 있어 그 관례를 따른다 (audit:I06)
- v0.1.6 (2026-09-21) I07 범위에 lib/terms/access.ts 와 index.ts 와 용어집을 더했다, 신규 화면은 처음부터 @/lib/terms 만 쓰는 것이 중량 규정이고 이 도메인의 말(표면·부여·열기·막기·하위 포함)이 아직 어디에도 없다, 화면에 직접 적으면 두 번째 화면이 그대로 복붙한다 (audit:I07)
- v0.1.7 (2026-09-21) I07 뒤에 I07a 를 넣었다, 접근권한 화면을 실제로 띄워 보니 표면 25개 중 6개(/admin·/dept-tasks·/kpi·/operations·/routine·/security)가 이름 자리에 주소를 그린다, navLabel 이 못 찾은 주소를 그대로 돌려주기 때문이고 그 여섯은 메뉴 배치에 없어 NAV_LABEL 에 이름이 없다, 이름은 lib/nav/menu.ts 가 SSOT 라 I07 범위 안에서 고칠 수 없다 (audit:I07)
- v0.1.6 (2026-09-21) I07 범위에 lib/terms/access.ts 와 index.ts 와 용어집을 더했다, 신규 화면은 처음부터 @/lib/terms 만 쓰는 것이 중량 규정이고 이 도메인의 말이 아직 없다 (audit:I07)
- v0.1.7 (2026-09-21) I07 뒤에 I07a 를 넣었다, 표면 25개 중 6개가 이름 자리에 주소를 그리고 이름은 lib/nav/menu.ts 가 SSOT 라 I07 범위 밖이다 (audit:I07)
- v0.1.8 (2026-09-21) I08 범위에 AppShell.tsx 를 더했다, 전체 메뉴(QuickNav)는 셸만 그리는데 그 셸이 서버 컴포넌트라 판정을 여기서 한 번 하면 여섯 셸이 함께 바뀐다, 화면마다 목록을 넘기게 하면 넘기는 것을 잊은 셸에 죽은 문이 남는다 (audit:I08)
- v0.1.8 (2026-09-21) I08 범위에 AppShell.tsx 를 더했다, 전체 메뉴를 그리는 셸이 서버 컴포넌트라 판정을 거기서 한 번 하면 여섯 셸이 함께 바뀐다 (audit:I08)
- v0.1.9 (2026-09-21) I09 의 감사 기준을 실행 가능한 말로 다시 적고 범위에 guard.ts 와 actions.ts 를 더했다. 「자동으로 구역이 된다」를 두 가지로 갈랐다 — 판정은 자동(주소만 있으면 구역 키가 나오고 부여가 없으면 표면 값으로 내려간다), 부여는 등재된 것만(access_grant 가 access_surface 에 외래키를 걸고 있어 사본에 행이 없으면 저장 자체가 안 선다). 그리고 구역을 소비하는 자리가 라우트 게이트(guard.ts)와 동기화(actions.ts)라 둘 없이는 부여가 조용히 무시된다 (audit:I09)
- v0.1.9 (2026-09-21) I09 감사 기준을 실행 가능하게 다시 적고 범위에 guard.ts 와 actions.ts 를 더했다, 구역을 소비하는 자리가 그 둘이라 없으면 부여가 조용히 무시된다 (audit:I09)
- v0.1.10 (2026-09-21) I09 범위에 lib/terms/access.ts 를 더했다, 구역을 고르는 칸에 「자리」와 「표면 전체」라는 새 말이 필요하고 신규 말은 화면보다 먼저 용어집에 올린다 (audit:I09)
- v0.1.10 (2026-09-21) I09 범위에 lib/terms/access.ts 를 더했다, 구역을 고르는 칸의 새 말을 화면보다 먼저 올린다 (audit:I09)
- v0.1.11 (2026-09-21) I09 범위에 lib/terms/action.ts 와 용어집을 더하고 감사 기준에 말 한 줄을 넣었다. 사용자 지적 ins_0076: 「막기」는 시스템에 없는 말이고 이 시스템은 이미 차단·차단됨을 쓴다. 상수만 고치면 다음 사람이 또 지어내므로 금지어 표에 올려 가드가 막게 한다 (iv_0076)
- v0.1.12 (2026-09-21) I10 범위와 기준을 고쳤다. 원래 범위에는 쓰기 창구가 하나도 없어 「보기만 받은 사람이 쓰기에서 403」을 잴 수 없었다 — withCrmApi 한 곳이 CRM 쓰기 전부를 지나므로 거기에 동작 판정을 건다(내부 역할 표는 그대로 두고 그 위에 문만 더한다). 내보내기 창구는 여덟인데 이 판에서 붙이는 것은 crm 하나라, 가드를 「지금보다 늘면 차단」으로 걸고 나머지는 사유와 함께 적는다. 나머지를 붙이는 일은 I10a 로 뺀다 (audit:I10)
- v0.1.11 (2026-09-21) I10 범위에 쓰기 창구(withCrmApi)와 화면·용어를 더하고, 내보내기 가드를 지금보다 늘면 차단으로 걸었다 (audit:I10)
- v0.1.12 (2026-09-21) I10 뒤에 I10a 를 넣었다, 내보내기 창구 여덟 중 이 판에서 붙이는 것은 하나라 나머지 일곱을 따로 세운다 (audit:I10)
- v0.1.13 (2026-09-21) I11 범위에서 decide.ts 를 빼고 sensitivity.ts·actions.ts·terms 를 넣었다. 판정 순서는 안 바뀌므로 decide.ts 는 손댈 것이 없고, 「전사 표준으로 올라온다」를 목록 복사가 아니라 **CRM 이 새 SSOT 를 import 하는 것**으로 읽었다 — 복사면 두 벌이 되고 그 둘이 갈리는 날이 온다. 그리고 범위를 화면에 안 보이면 계산만 하고 아무도 안 쓰는 값이 된다 (audit:I11)
- v0.1.13 (2026-09-21) I11 범위를 고쳤다, 능력은 CRM 이 새 SSOT 를 import 하게 하고 범위는 화면에 보인다 (audit:I11)
- v0.1.14 (2026-09-22) I11a 를 넣었다. 사용자가 테스트 계정에 접근권한을 주고 메뉴를 눌렀더니 「영업 CRM 사용 권한이 없습니다. 관리자에게 요청해 주세요」가 떴다(ins_0078). 서비스 넷은 자기 멤버십 장치가 따로라 부여만으로는 안 열리고, 메뉴는 부여로 떠서 **죽은 문**이 됐다 — I08 이 없앤 것과 같은 모양이 서비스 쪽에 남아 있었다. 플랜 「범위 밖」의 «서비스 내부 역할은 그대로» 는 역할 체계를 안 건드린다는 뜻이지 문을 안 연다는 뜻이 아니므로, 문 여닫기만 여기서 잇는다 (iv_0078)
- v0.2.0 (2026-09-22) 사용자 개입: 접근권한을 줘도 서비스 메뉴를 누르면 막힌다, 서비스 문까지 잇는 항목 I11a 를 넣었다 (audit:I11)
