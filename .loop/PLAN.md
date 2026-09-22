# PLAN newAX: 표면 안의 탭도 닫힌 곳을 안 그린다
플랜 ID: P0049
플랜 버전: v0.1.1
상태: 진행중
지시: ins_0087
목표 버전: v0.10.381
작성: 2026-09-22
시작 커밋: 7bb8416c

## 목표
- 표면·자리를 건너가는 탭과 링크가 닫힌 곳을 안 그린다 (P0046 이 사이드바·전체 메뉴에서 없앤 죽은 문을 한 층 아래에서도 없앤다)
- 판정 목록을 셸이 한 번 계산해 내려보내고, 화면은 그것만 읽는다 (화면이 손목록을 다시 들지 않는다)
- 건너가는 내비게이터가 새로 생기면 가드가 그 자리에서 잡는다

## 범위 밖
- 서비스(CRM·CI·AI·RFP) 안쪽의 탭 — 그 서비스의 멤버십이 먼저 막고, 축이 다르다
- 같은 표면 안에서만 도는 링크 (상세·새로 만들기) — 레이아웃 게이트가 이미 지난 자리다
- 접근권한 화면과 판정 함수 자체 (P0046 에서 끝났다)

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 부여가 0건일 때 업무 탭바·구 영업 탭바·홈이 이 판 앞뒤로 같다
- 표면 하나를 닫으면 사이드바·전체 메뉴·탭바·홈에서 **함께** 사라진다 (실측)
- 건너가는 내비게이터를 하나 더 만들고 판정을 안 보면 가드가 실패한다

## 참조
- .loop/archive/P0046-v0.10.365-접근권한으로-메뉴를-연다.md (판정·게이트의 출처)
- apps/web/lib/access/guard.ts (openSurfaces)
- apps/web/components/ui/shell/AppShell.tsx (셸이 한 번 계산하는 자리)

## 항목

### I01 열린 목록을 셸이 한 번 계산해 내려보낸다
상태: 통과
모드: 경량
범위: apps/web/lib/access/open-context.tsx (신규), apps/web/components/ui/shell/AppShell.tsx, apps/web/components/ui/QuickNav.tsx
감사 기준:
- 셸이 표면과 등재된 자리 전부를 한 번 판정해 컨텍스트로 내려보낸다 (부여 조회는 요청당 1회 그대로, 화면 소스에 왕복이 안 는다)
- 전체 메뉴가 props 대신 컨텍스트를 읽고, 그리는 목록이 이 판 앞뒤로 같다
- pnpm tsc --noEmit 통과
의존: 없음

### I02 건너가는 내비게이터를 가드가 센다
상태: 통과
모드: 경량
범위: apps/web/lib/ui/cross-surface-nav.test.ts (신규), apps/web/package.json
감사 기준:
- 표면·자리를 건너가는 주소를 손목록으로 든 부품을 전수로 찾는다
- 지금 잡히는 것을 사유와 함께 유예 목록에 적고, **유예에 없는 부품이 생기면 실패한다** (기존 가드들과 같은 ratchet, 즉시 차단으로 걸면 공유 트리의 pnpm test 가 통째로 빨개진다)
- 셸 밖 화면은 사유와 함께 면제한다 (컨텍스트가 없어 물어도 늘 참이다)
- 새 부품을 하나 만들어 잡히는 것을 확인하고 지운다
의존: I01

### I03 업무 탭바가 닫힌 곳을 안 그린다
상태: 통과
모드: 경량
범위: apps/web/components/ui/WorkTabBar.tsx, apps/web/lib/ui/cross-surface-nav.test.ts
감사 기준:
- 탭 다섯이 컨텍스트를 읽어 열린 것만 그린다 (표면 셋 + 자리 둘)
- 부여 0건이면 다섯 다 그대로 뜬다
- 일일업무를 닫으면 그 탭만 사라지고 나머지 넷은 남는다 (실측)
의존: I01, I02

### I04 구 영업 탭바가 닫힌 표면을 안 그린다
상태: 통과
모드: 경량
범위: apps/web/components/ui/ProjectTabs.tsx, apps/web/lib/ui/cross-surface-nav.test.ts
감사 기준:
- 탭 넷이 컨텍스트를 읽어 열린 것만 그린다
- 거래처 하나만 열어 준 사람에게 나머지 셋이 안 보인다 (실측)
- 넷 다 닫히면 탭바 자체를 안 그린다 (빈 줄이 남지 않는다)
의존: I01, I02

### I05 남은 내비게이터 셋이 닫힌 곳을 안 그린다
상태: 통과
모드: 경량
범위: apps/web/app/(member)/home/page.tsx, apps/web/components/ui/SidebarProfile.tsx, apps/web/app/(ai)/ai/analyze/WorkflowHandoffModal.tsx, apps/web/lib/ui/cross-surface-nav.test.ts
감사 기준:
- 홈에서 다른 표면으로 보내는 자리(루틴·KPI·본부 운영·주간보고)가 열린 것만 그린다
- 계정 메뉴(API Keys·개발자센터·보안)와 AI 넘김 모달(부서 업무·주간보고·프로젝트 현황)이 열린 것만 그린다
- 가드의 유예 목록이 0이 되고, 그 뒤로는 새 부품이 판정을 안 보면 실패한다
- 일부러 깨뜨려 실패를 확인한다
의존: I01, I02

### I06 닫으면 네 자리에서 함께 사라진다
상태: 대기
모드: 중량
범위: .loop/PLAN.md, apps/web/lib/changelog/entries.ts, package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- 보안: 표면 하나를 닫은 상태에서 주소를 직접 쳐도 막히는 것을 다시 확인한다 (P0046 게이트가 그대로 산다)
- 표면 하나를 닫으면 사이드바·전체 메뉴·업무 탭바·홈 넷에서 함께 사라진다 (일반 사용자로 실측하고 되돌린다)
- 부여 0건일 때 네 자리가 이 판 앞뒤로 같다
- 사용자 체감 변경이 업데이트 내역에 적힌다
의존: I03, I04, I05

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-22) 최초 작성 (ins_0087)
- v0.1.1 (2026-09-22) I02 의 기준을 고치고 I05 범위를 넓혔다. ①가드를 즉시 차단으로 적었는데 공유 트리에서는 pnpm test 가 통째로 빨개져 아무 일도 못 한다 — 기존 가드들(내보내기·용어집)과 같은 ratchet 으로 바꿨다. ②가드를 세우자 손으로 훑어 못 본 내비게이터 둘이 더 잡혔다: 계정 메뉴(SidebarProfile)와 AI 넘김 모달(WorkflowHandoffModal). 셋이 아니라 다섯이었다 — 가드를 먼저 세운 값이 바로 이것이다 (audit:I02)
- v0.1.1 (2026-09-22) I02 기준을 ratchet 으로 고치고, 가드가 새로 찾은 내비게이터 둘을 I05 범위에 넣었다 (audit:I02)
