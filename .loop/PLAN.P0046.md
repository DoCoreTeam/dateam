# PLAN newAX: 접근권한으로 메뉴를 연다
플랜 ID: P0046
플랜 버전: v0.1.0
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
상태: 대기
모드: 경량
범위: apps/web/lib/nav/menu.ts, apps/web/app/(member)/layout.tsx, apps/web/components/ui/QuickNav.tsx, apps/web/lib/nav/menu.test.ts
감사 기준:
- 사이드바와 전체 메뉴의 항목이 등재부에서 생성된다 (손목록 상수 제거 확인)
- 관리자와 일반 사용자가 보는 메뉴가 이 판 앞뒤로 동일하다 (테스트로 목록을 대조)
- pnpm test 통과
의존: I02

### I05 부여를 담을 표를 만든다
상태: 대기
모드: 중량
범위: supabase/migrations/277_access_control.sql (신규)
감사 기준:
- 보안: 두 표 모두 같은 마이그레이션에서 RLS 를 켠다 (rowsecurity=true 를 psql 로 확인)
- 보안: 정책 대상에 TO public 을 쓰지 않는다, 쓰기는 관리자만, anon 권한 0
- 마이그레이션 적용 후 기존 행이 하나도 안 바뀐다 (새 표만 생성, 기존 표 변경 없음)
의존: I02

### I06 부여를 읽되 화면은 그대로다
상태: 대기
모드: 경량
범위: apps/web/lib/access/load.ts (신규), apps/web/lib/access/load.test.ts (신규), apps/web/app/(member)/layout.tsx, apps/web/package.json
감사 기준:
- 부여가 0건이면 관리자와 일반 사용자의 메뉴가 I04 직후와 한 글자도 다르지 않다
- 같은 요청 안에서 부여 조회가 1회로 고정된다 (요청 캐시 확인)
- pnpm test 통과
의존: I04, I05

### I07 관리자가 화면에서 연다
상태: 대기
모드: 중량
범위: apps/web/app/admin/access/page.tsx (신규), apps/web/app/admin/access/AccessClient.tsx (신규), apps/web/app/admin/access/actions.ts (신규), apps/web/app/api/admin/access/route.ts (신규), apps/web/app/admin/layout.tsx
감사 기준:
- 보안: 창구가 requireAdminApi 를 부른다, 비관리자 호출이 403 을 받는다
- 보안: 주체 id 와 표면 키를 등재부와 대조해 모르는 값은 저장하지 않는다
- 표면에 부서를 붙이고 저장하면 그 부서 사람 수가 미리보기 숫자와 일치한다
- 미등재 표면 수가 화면 위에 뜬다
의존: I06

### I08 숨기는 것과 막는 것이 같은 판정을 쓴다
상태: 대기
모드: 중량
범위: apps/web/lib/access/guard.ts (신규), apps/web/app/(member)/layout.tsx, apps/web/components/ui/QuickNav.tsx, apps/web/app/(member)/accounts/layout.tsx, apps/web/app/(member)/contacts/layout.tsx, apps/web/app/(member)/deals/layout.tsx, apps/web/app/(member)/lead-intake/layout.tsx
감사 기준:
- 보안: 메뉴에서 숨긴 표면은 주소를 직접 쳐도 막힌다, 관리자는 항상 통과한다
- 부여를 받은 일반 사용자의 사이드바와 전체 메뉴에 그 표면이 함께 나타난다
- 안 열린 표면은 전체 메뉴에서도 사라진다 (죽은 문 0개)
의존: I07

### I09 표면 안의 자리를 가른다
상태: 대기
모드: 경량
범위: apps/web/lib/access/surfaces.ts, apps/web/lib/access/decide.ts, apps/web/lib/access/decide.test.ts, apps/web/app/admin/access/AccessClient.tsx
감사 기준:
- 하위 경로는 표면에서 자동으로 구역이 되고, 경로가 아닌 탭은 등재부에 적힌 것만 구역이 된다
- 구역을 안 건드린 부여는 표면 값이 그대로 내려간다
- pnpm test 통과
의존: I08

### I10 동작을 가르고 내보내기를 잠근다
상태: 대기
모드: 중량
범위: apps/web/lib/access/actions.ts (신규), apps/web/lib/access/decide.ts, apps/web/lib/policy/export-gate.test.ts (신규), apps/web/app/api/crm/export/route.ts, apps/web/lib/crm/services/export.ts, apps/web/package.json
감사 기준:
- 보안: 내보내기 라우트가 동작 판정을 부른다, 권한 없는 사용자가 403 을 받는다
- 보안: 내보내기 판정을 안 부르는 내보내기 라우트가 있으면 가드가 실패한다, 일부러 깨뜨려 확인한다
- 보기만 프리셋을 받은 사람은 쓰기 창구에서 403 을 받는다
의존: I09

### I11 값과 범위를 가른다
상태: 대기
모드: 경량
범위: apps/web/lib/access/capabilities.ts (신규), apps/web/lib/access/decide.ts, apps/web/lib/access/decide.test.ts, apps/web/app/admin/access/AccessClient.tsx
감사 기준:
- CRM 능력 5종이 전사 표준 이름으로 올라오고 CRM 쪽 판정 결과가 바뀌지 않는다
- 범위 셋(내 것, 부서, 전사)이 조직 스코프 결과와 일치한다
- pnpm test 통과
의존: I10

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
