# PLAN newAX: 관리자가 AI 트레이딩에 닿는다 — 소유자 지정·메뉴 배치·접근권한 화면
플랜 ID: P0071
플랜 버전: v0.3.5
상태: 진행중
지시: ins_0116
목표 버전: v0.10.575
작성: 2026-09-26
시작 커밋: 54c16c15

## 목표
- 관리자가 AI 트레이딩에 실제로 들어간다, 지금은 두 겹이 동시에 막고 있다
  - 실측 1: trading_settings.owner_user_id 가 빈 문자열이라 decideTradingAccess 가 no_owner 로 **아무도** 안 들여보낸다, 그 값을 정하는 화면은 소유자만 들어가는 문 안에 있어 영영 못 정한다
  - 실측 2: /trading 이 사이드바 배치 목록(SIDEBAR_TOP·SIDEBAR_GROUPS)에 **아예 없다**, 접근권한을 줘도 사이드바에는 안 생긴다, 권한 문제가 아니라 배치 누락이다
- 사이드바에 없고 전체 메뉴에만 있는 표면은 그 사유가 코드에 적혀 있다, 적지 않으면 가드가 막는다
- 접근권한 화면이 「관리자는 역할로 이미 전부 들어간다」는 사실을 말한다, 지금은 부여 0건으로 보여 관리자가 아무도 안 들어간 줄로 읽힌다
- 사람 고르는 자리가 모달 피커가 되고, 이름 옆 꼬리표가 내부 용어가 아니라 실제 소속 부서가 된다

## 범위 밖
- 트레이딩 설정 나머지 편집 화면 신설(88개 값·KIS 자격증명 등록), 이번엔 소유자 한 줄만 연다, 나머지는 다음 플랜
- 검증 관문 값 배선(백테스트 지표 저장·읽기), 별개 고장이라 다음 플랜
- access_grant 스키마 변경, 관리자 줄은 저장하지 않고 화면이 그리기만 한다
- 조직 고르기의 하위 포함 규칙 변경, 퇴사자 처리 규칙 변경

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 소유자를 지정한 뒤 그 사람의 **사이드바**에 AI 트레이딩이 서고 눌러서 들어간다
- 소유자가 아닌 관리자에게는 사이드바와 전체 메뉴 둘 다에 AI 트레이딩이 없다, 죽은 문을 안 남긴다
- 관리자 두 사람(김도현·AI채팅테스트)이 접근권한 화면의 표면 줄마다 회색으로 보인다
- 사람·조직 고르기가 RecordPickerField 이고 native select 가 남아 있지 않다
- 사용자 노출 문자열은 lib/terms 경유
- 실브라우저로 소유자 지정부터 진입까지 한 번 통과시킨다, 정적 검증만으로 끝내지 않는다

## 참조
- LOOP.md 7절 보안 기준, 부록 버전 규칙
- apps/web/lib/trading/access-decide.ts 소유자 판정 (no_owner 는 아무도 못 들어간다)
- apps/web/lib/access/decide.ts 표면 판정 순서 (관리자 최우선)
- apps/web/lib/nav/menu.ts SIDEBAR_TOP·SIDEBAR_GROUPS·QUICKNAV_SECTIONS 배치 SSOT
- apps/web/lib/access/guard.ts openMap·openSurfaces (메뉴와 라우트가 같은 함수를 본다)
- apps/web/components/ui/RecordPicker.tsx 「많은 것 중에서 하나 고르기」 SSOT
- 실측 2026-09-26 psql: access_grant 에 trading→김도현 allow 1줄이 이미 있는데도 안 보였다, trading_settings.owner_user_id = ''

## 항목

### I04 AI 트레이딩 소유자를 접근권한 화면에서 지정한다
상태: 통과
모드: 중량
범위: apps/web/app/api/admin/trading-owner/route.ts (신규), apps/web/app/admin/access/actions.ts, apps/web/app/admin/access/AccessClient.tsx, apps/web/lib/trading/owner-admin.ts (신규), apps/web/lib/terms/access.ts, apps/web/lib/terms/index.ts, apps/web/lib/policy/trading-knowledge-guard.test.ts, apps/web/lib/trading/access.ts, apps/web/lib/policy/trading-owner-surface.test.ts (신규), apps/web/package.json
감사 기준:
- 보안: 새 창구다, requireAdmin 계열 인증 장치를 부르고 관리자가 아니면 403 이다, 서비스롤 자리 위에 사람 확인이 있다, apps/web/lib/policy/api-auth-surface.test.ts 통과
- 보안: 밖에서 온 값은 userId 하나이고 profiles 실제 행(deleted_at is null)과 대조한 뒤에만 저장한다, 없는 id 면 저장 안 하고 사유를 돌려준다
- 보안: 새 모듈 맨 위에 import 'server-only' 가 있다
- 저장은 saveTradingSetting 을 지난다, trading_settings 를 직접 insert 하지 않는다 — grep 으로 확인
- 접근권한 화면 AI 트레이딩 줄에 소유자 칸이 서고 저장 뒤 현재 소유자 이름을 그린다
- 지정 뒤 그 사람이 /trading 에 들어가고 지정 전에는 no_owner 로 막힌다 — node --test 로 확인
- 소유자를 바꾼 일이 reason 에 누가 언제 바꿨는지와 함께 남는다
- 가드를 일부러 깨서 실패를 확인하고 되돌린다
의존: 없음

### I05 사이드바가 AI 트레이딩을 그리고, 메뉴와 문이 같은 답을 한다
상태: 통과
모드: 중량
범위: apps/web/lib/nav/menu.ts, apps/web/lib/access/guard.ts, apps/web/lib/access/extra-gate.ts (신규), apps/web/lib/trading/access.ts, apps/web/app/(member)/layout.tsx, apps/web/lib/nav/menu.test.ts, apps/web/lib/ui/nav-standard.test.ts, apps/web/lib/access/load.test.ts, apps/web/lib/policy/menu-placement.test.ts (신규), apps/web/lib/access/extra-gate.test.ts (신규), apps/web/package.json
감사 기준:
- 보안: 메뉴가 숨기는 것과 라우트가 막는 것이 같은 답이다, /trading 이 openMap 에서 소유자가 아닌 사람에게 false 다
- 보안: 추가 문은 숨기기만 하고 막기를 대신하지 않는다, app/(member)/trading/layout.tsx 의 소유자 확인을 지우지 않는다 — 파일이 그대로인 것을 확인
- AI 트레이딩이 사이드바 배치에 서고, 소유자인 관리자에게 사이드바에 뜬다
- menu-placement.test.ts 신설: 등재부 표면 중 **사이드바에 없고 전체 메뉴에만 있는 것**을 세고, 면제 목록에 사유가 적힌 것만 통과시킨다, 사유 없는 표면이 있으면 실패한다
- extra-gate.test.ts 신설: 소유자·비소유자 관리자·일반 사용자 세 경우를 단정한다
- 가드 둘을 일부러 깨서 실패를 확인한다(배치를 다시 빼면 menu-placement 가, 추가 문을 안 보면 extra-gate 가 잡힘)
- apps/web/package.json 의 test 스크립트에 등재하고, 등재 뒤 총 테스트 수가 실제로 늘어난 것을 확인한다
의존: I04

### I05a 실브라우저로 소유자 지정부터 진입까지 확인한다
상태: 통과
모드: 경량
범위: (검증 전용, 코드 변경 없음 · 발견한 고장은 해당 항목으로 되돌아가 고친다)
감사 기준:
- 격리 서버(NEXT_DIST_DIR · :3100)에서 관리자로 로그인해 접근권한 화면에서 소유자를 지정한다
- 지정 뒤 사이드바에 AI 트레이딩이 뜨고 눌러서 /trading 이 열린다, AccessDenied 가 안 뜬다
- 소유자를 비우면 사이드바에서 사라지고 주소를 직접 쳐도 막힌다
- 스크린샷으로 사이드바에 실제로 그려진 것을 확인한다, read_page 만으로 판정하지 않는다
- 만든 데이터(소유자 설정 판)는 확인 뒤 실제 소유자로 되돌린다
의존: I05

### I01 관리자가 이미 들어간다는 사실을 화면이 말한다
상태: 통과
모드: 경량
범위: apps/web/app/admin/access/actions.ts, apps/web/app/admin/access/AccessClient.tsx, apps/web/lib/terms/access.ts, apps/web/lib/access/admin-row.test.ts (신규), apps/web/package.json
감사 기준:
- loadAccessAdminData 반환에 admins 배열(관리자 id·이름)이 있고, profiles.role='admin' 이고 deleted_at 이 null 인 사람만 든다
- 표면 줄을 펼치면 부여 목록 맨 위에 삭제 단추 없는 회색 줄이 서고, 그 줄에 관리자 이름 전부와 「역할로 언제나 들어갑니다」 뜻의 문구가 있다
- 부여가 0건인 표면도 빈 상태가 아니라 이 회색 줄을 그린다
- node --test apps/web/lib/access/admin-row.test.ts 통과, 관리자 줄이 access_grant 가 아니라 role 에서 나온다는 것과 삭제 불가를 단정한다
- test 스크립트에 등재하고 총 테스트 수가 늘어난 것을 확인한다
의존: I05a

### I02 사람 옆 꼬리표를 내부 용어에서 소속 부서로 바꾼다
상태: 통과
모드: 경량
범위: apps/web/app/admin/access/actions.ts, apps/web/app/admin/access/AccessClient.tsx, apps/web/lib/terms/access.ts
감사 기준:
- PersonOption 에 소속 부서 이름이 실리고 org_nodes 에서 그 사람 노드의 부모 이름을 쓴다, 배치 안 된 사람은 빈 값이다
- 사람 고르는 자리에 「이름 · 내 것」 「이름 · 부서」 가 더 안 나온다, ACCESS_RANGE_LABEL 은 고른 뒤 안내 한 문장 자리에서만 나온다
- 고른 뒤 안내 문장은 ACCESS_RANGE_WHY 한 벌만 쓰고 범위 말을 두 자리에서 안 되풀이한다
의존: I01

### I03 사람과 조직을 드롭다운이 아니라 모달로 고른다
상태: 통과
모드: 경량
범위: apps/web/app/admin/access/AccessClient.tsx, apps/web/lib/ui/picker-standard.test.ts (신규), apps/web/package.json
감사 기준:
- AccessClient 의 사람·조직 칸이 RecordPickerField 이고 그 두 자리에 select 태그가 없다
- 조직을 고르면 미리보기 사람 수가 예전과 같은 값을 그린다(orgOptions 의 directCount·subtreeCount)
- picker-standard.test.ts 신설: 서버·DB 에서 온 목록을 select 로 그리는 자리를 잡는다, 고정 목록(허용/차단·프리셋)은 면제 목록에 사유와 함께 적는다
- 그 가드를 일부러 깨서 실패를 확인한다
- test 스크립트에 등재하고 총 테스트 수가 늘어난 것을 확인한다
의존: I02

### I06 종합 감사와 업데이트 내역
상태: 통과
모드: 경량
범위: apps/web/lib/changelog/entries.ts, 루트 package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- LOOP.md 7절 「기계가 세는 것」 다섯 줄을 실행하고 결과를 적는다, 전부 0 이다
- 버전 여섯 파일이 같은 값이고 앞 커밋보다 높다
- entries.ts 맨 위에 이번 판 블록이 있고 사용자가 체감하는 말로 적혀 있다
의존: I03

## 종합 감사
결과: pass (2026-09-26)

### 검사 넷
- `pnpm tsc --noEmit` — 통과 (오류 0)
- `pnpm lint` — 통과 (오류 0, 경고는 전부 이 판 밖의 기존 것)
- `pnpm test` — 7871/7871 통과, 실패 0 (플랜 시작 시점 7839 → 등재 파일 635 → 640)
- `pnpm build` — 통과 (`NEXT_DIST_DIR=.next-p0071b`, Compiled successfully in 86s, 정적 295/295, 오류 0)
  - 새 창구가 빌드 산출에 실제로 섬: `ƒ /api/admin/trading-owner`
- `pnpm design:check` — 통과 (hex 0, 기준 초과 0)

### 완료 정의 대조
- 소유자를 지정한 뒤 그 사람의 사이드바에 AI 트레이딩이 서고 눌러서 들어간다 — I05a 실브라우저 확인, 스크린샷 5·6
- 소유자가 아닌 관리자에게는 사이드바·전체 메뉴 둘 다에 없다 — `lib/access/extra-gate.ts` 가 두 메뉴 함수(openSurfaces·openMap)에서 지움, 단정은 extra-gate.test.ts
- 관리자 두 사람이 표면 줄마다 회색으로 보인다 — I01, `profiles.role='admin'` 에서 나오고 삭제 단추 없음
- 사람·조직 고르기가 RecordPickerField 이고 native select 가 남아 있지 않다 — I03, picker-standard.test.ts 가 그 화면을 0 으로 건다
- 사용자 노출 문자열은 lib/terms 경유 — 새 문자열 여덟이 전부 `lib/terms/access.ts` 에 있고 화면은 `@/lib/terms` 하나만 import
- 실브라우저로 소유자 지정부터 진입까지 통과 — I05a

### 보안 다섯 줄 (LOOP.md 7절 「기계가 세는 것」)
`psql $DATABASE_URL -f docs/policy/security-count.sql` 실행 결과, 2026-09-26

| 세는 것 | 결과 |
|---|---|
| rls_off_tables | 0 |
| anon_write_tables | 0 |
| public_using_true_policies | 0 |
| unpinned_secdef_functions | 0 |
| anon_readable_secdef_views | 0 |

다섯 줄 전부 0

### 전체 diff 검토
`git diff 54c16c15..HEAD --stat` — 파일 26개, 1541 추가 / 73 삭제
- 범위 밖 변경 없음 (모든 파일이 항목 범위에 적혀 있고, 늘어난 넷은 plan revise 로 사유와 함께 올렸음)
- 비밀 없음 — 추가 줄에서 service_role·토큰·키 형태 0건
- 하드코딩된 사용자 노출 문자열 없음 — 새 문구는 전부 lib/terms
- 새 표 0개 (기존 `trading_settings` 에 판을 쌓을 뿐), 마이그레이션 0개 → S1 해당 없음
- 새 창구 1개 (`POST /api/admin/trading-owner`), `requireAdminApi` 뒤에 있고 api-auth-surface 가 확인

### 항목 대 결과 대조
- I04 `lib/trading/owner-admin.ts`·`app/api/admin/trading-owner/route.ts` 신설 확인, 접근권한 화면에 소유자 칸 존재
- I05 `lib/access/extra-gate.ts` 신설, 사이드바 배치에 `{ surface: 'trading' }` 존재, 아이콘 등재
- I05a 코드 변경 없음(검증 전용), 확인 뒤 임시 스펙 삭제·격리 서버 종료·tsconfig 되돌림
- I01 `lib/access/admin-row.test.ts` 신설, `admins` 가 `AccessAdminData` 에 있음
- I02 `PersonOption.dept` 존재, `ACCESS_RANGE_LABEL` 사용처 0곳이 되어 제거
- I03 `lib/ui/picker-standard.test.ts` 신설(RecordPicker 머리말이 가리키던 그 파일), 등재 완료
- I06 이 절

### 발견 사항
- 되돌린 결정 하나: v0.10.449 에 「AI 트레이딩은 사이드바를 차지하지 않는다」로 일부러 뺐던 것을 세웠다. 그때 이유(모든 관리자의 사이드바를 차지한다)는 추가 문이 비소유자에게서 그 줄을 지우면서 사라졌고, 안 세운 대가로 소유자가 자기 모듈을 못 찾았다
- 가드가 실제로 잡은 것 둘: `trading-knowledge-guard` 가 새 설정 쓰기 자리를 잡아 허용 목록 등재를 요구했고, `load.test.ts` 의 사이드바 모형이 추가 문을 몰라 실패했다 — 둘 다 고쳤다
- 주석 하나 정정: `lib/trading/access.ts` 가 「소유자 변경은 다음 거래일부터」라고 적고 있었는데 이번 판이 오늘부터로 쌓으므로 사실과 반대가 되어 고쳤다
- 남는 빚 아님(기록용): 드롭다운으로 그리는 목록이 아직 109곳이다. picker-standard 가 「늘면 차단」으로 잠갔고 줄이는 것은 그 화면을 건드릴 때 함께 한다

## 변경 이력
- v0.1.0 (2026-09-26) 최초 작성 (ins_0116)
- v0.2.0 (2026-09-26) 개입 iv_0118 반영 — 실제 고장(소유자 미지정·사이드바 배치 누락)을 앞으로 당기고 겉모습 항목을 뒤로 보냄, 배치 누락 가드와 실브라우저 확인 항목 I05a 추가, 사용자 지적 「데모나 하드코딩 하지 말고 제대로 마무리까지」
- v0.3.0 (2026-09-26) 실제 고장 둘(소유자 미지정·사이드바 배치 누락)을 앞으로 당기고 겉모습 항목을 뒤로, 배치 누락 가드와 실브라우저 확인 추가 (iv_0118)
- v0.3.1 (2026-09-26) I04 범위에 apps/web/lib/terms/access.ts 와 index.ts 추가, 그리고 apps/web/lib/policy/trading-knowledge-guard.test.ts 추가 — 설정 쓰기 허용 목록에 새 자리를 사유와 함께 올려야 그 가드가 통과한다(가드가 실제로 새 쓰기 자리를 잡아냄), 그리고 apps/web/lib/trading/access.ts 주석 한 문단 정정 — 「소유자 변경은 다음 거래일부터」라고 적혀 있었는데 이번 판이 오늘부터로 쌓으므로 읽는 쪽 주석이 사실과 반대가 됨 — 소유자 칸의 사용자 노출 문자열은 화면에 직접 적지 않고 용어집을 지나야 한다(완료 정의 「사용자 노출 문자열은 lib/terms 경유」), 원래 범위에 그 파일이 없어 화면에 직접 적게 되어 있었음 (audit:I04)
- v0.3.1 (2026-09-26) I04 범위에 lib/terms/access.ts 추가 — 소유자 칸 문자열은 용어집을 지나야 한다 (audit:I04)
- v0.3.2 (2026-09-26) I04 범위에 trading-knowledge-guard.test.ts 추가 — 설정 쓰기 허용 목록 등재 (audit:I04)
- v0.3.3 (2026-09-26) I04 범위에 lib/trading/access.ts 추가 — 소유자 유효일 주석이 사실과 반대가 되어 정정 (audit:I04)
- v0.4.0 (2026-09-26) I05 범위 넷 추가 — 추가 문 판정을 순수 모듈 lib/access/extra-gate.ts 에 둬야 node --test 로 세 경우를 잴 수 있고(guard.ts 는 server-only), 소유자 한 값을 요청당 한 번만 읽으려면 lib/trading/access.ts 가 그것을 내놓아야 하며, 사이드바에 한 줄이 서면 기존 스냅샷 가드 둘(lib/nav/menu.test.ts 의 BEFORE·lib/ui/nav-standard.test.ts 의 N-1 동일성)이 그 사실을 반영해야 한다 (audit:I05)
- v0.3.4 (2026-09-26) I05 범위에 extra-gate.ts·trading/access.ts·menu.test.ts·nav-standard.test.ts 추가 (audit:I05)
- v0.4.1 (2026-09-26) I05 범위에 apps/web/lib/access/load.test.ts 추가 — 그 가드가 사이드바를 decideAccess 하나로만 본떠서, 추가 문이 지우는 줄을 모른 채 실패했다, 본뜨는 자리에도 추가 문을 넣어야 화면과 같은 것을 본다 (audit:I05)
- v0.3.5 (2026-09-26) I05 범위에 load.test.ts 추가 — 사이드바 모형에 추가 문 반영 (audit:I05)
