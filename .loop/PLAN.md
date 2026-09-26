# PLAN newAX: AI 트레이딩이 서비스가 된다 — 자기 셸·메뉴 구성·설정 화면
플랜 ID: P0072
플랜 버전: v0.1.1
상태: 진행중
지시: ins_0117
목표 버전: v0.10.582
작성: 2026-09-27
시작 커밋: 4b12363d

## 목표
- AI 트레이딩이 다른 서비스 넷과 **같은 골격**을 갖는다, 지금은 입구만 같고 안은 다르다
  - 실측: `/trading` 아래 하위 경로 0개 (영업 CRM 17개, 콘텐츠 인텔리전스 16개), `SERVICE_NAV` 와 `lib/nav/surface.ts` 어디에도 없어 들어가도 사이드바가 안 바뀌고 나가는 문도 없다, §2-3-3 N-1·N-2 를 절반만 지킨 상태다
- 한 화면에 쌓인 것을 경로로 나눈다
  - 실측: `page.tsx` 한 장이 패널 12개 + 최근 실행 + 설정 묶음 15개(값 88개)를 세로로 쌓는다, 사용자 지적 2026-09-27 「지금 화면 스크롤은 너무 과한데?」
- **설정을 고칠 수 있게 한다**, 지금은 볼 수만 있다
  - 실측: 88개 값이 읽기 전용 `<dl>` 로 그려질 뿐이고 값을 바꾸는 길은 좁은 토글 셋(알림·야간신호·자동주문)뿐이다, 사용자 지적 「설정하는 것 자체가 없네」
- 증권사 자격증명을 화면에서 등록한다
  - 실측: `lib/trading/broker/credentials.ts` 의 `saveTradingCredentials` 를 부르는 자리가 0곳이다

## 범위 밖
- 매매 판단 규칙과 신호 규칙 변경, 이번 판은 **닿는 길과 고치는 길**만 만든다
- 자동 주문 활성화, 무장 토글은 지금 동작을 그대로 옮기기만 한다
- 다른 서비스 넷의 셸 변경, 트레이딩을 그 골격에 맞추는 쪽이다
- 소유자 판정과 추가 문 규칙 변경 (P0071 에서 정한 대로 둔다)

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- `/trading` 에 들어가면 사이드바가 AI 트레이딩 것으로 바뀌고 하단에 나가는 문이 한 벌 선다
- `SERVICE_NAV` 에 등재되어 `lib/ui/nav-standard.test.ts` 의 N-1 이 **동일성**으로 돌아간다 (P0071 에서 포함으로 완화했던 것을 되돌린다)
- 어느 한 화면도 패널을 열 개 넘게 쌓지 않는다, 가드가 센다
- 설정 88개를 화면에서 고칠 수 있고, 저장한 값이 다음 판으로 쌓여 다시 읽힌다
- 증권사 자격증명을 화면에서 등록하고 등록 여부가 화면에 뜬다, 비밀 자체는 다시 안 보인다
- 사용자 노출 문자열은 lib/terms 경유
- 실브라우저로 셸 교체부터 설정 저장까지 한 번 통과시킨다

## 참조
- LOOP.md 7절 보안 기준, 부록 버전 규칙
- .claude/heavy/CEO.md §2-3-3 길의 축 N-1~N-5 (들어가는 문 한 자리, 나가는 문 한 벌·한 문구)
- apps/web/app/(crm)/layout.tsx 서비스 셸 본보기 (AppShell + 자기 NAV + canOpen + 나가는 문)
- apps/web/lib/crm/nav/groups.ts 서비스 안 메뉴 구성 본보기
- apps/web/lib/nav/surface.ts SERVICE_ROUTES 경로표 SSOT, apps/web/lib/terms/entity.ts SERVICE_LABEL
- apps/web/lib/trading/settings/registry.ts 값 88개와 묶음 15개
- apps/web/lib/trading/settings/store.ts saveTradingSetting (판을 쌓는다, 덮어쓰지 않는다)
- apps/web/lib/trading/broker/credentials.ts saveTradingCredentials·getTradingCredentialStatus
- apps/web/lib/access/extra-gate.ts 소유자만 메뉴에 보이는 추가 문 (P0071)

## 항목

### I01 트레이딩이 자기 셸을 갖는다
상태: 통과
모드: 중량
범위: apps/web/app/(trading)/layout.tsx (신규), apps/web/app/(trading)/trading/ 전체 (이동 — page·layout·actions·패널 12), apps/web/lib/trading/nav/groups.ts (신규), apps/web/lib/policy/app-dirs.ts (신규), apps/web/lib/nav/surface.ts, apps/web/lib/nav/menu.ts, apps/web/lib/terms/entity.ts, apps/web/lib/terms/index.ts, apps/web/lib/access/surfaces.ts, apps/web/lib/access/extra-gate.ts, apps/web/lib/trading/calendar/events.ts, apps/web/lib/auth/api-user-gate.test.ts, apps/web/lib/nav/menu.test.ts, apps/web/lib/ui/nav-standard.test.ts, apps/web/lib/access/extra-gate.test.ts, apps/web/lib/trading/overview-shape.test.ts, apps/web/lib/trading/signal/ack.test.ts, apps/web/lib/trading/jobs/order-job.test.ts, apps/web/lib/trading/jobs/operator-job.test.ts, apps/web/lib/policy/trading-signal-order-guard.test.ts, apps/web/lib/policy/trading-no-order-guard.test.ts, apps/web/lib/policy/trading-knowledge-guard.test.ts
감사 기준:
- 보안: 셸을 옮기면 (member) 레이아웃이 걸던 문이 안 걸린다, 새 레이아웃이 redirectApiUser·requireAdminMfa·canOpen('/trading')·소유자 확인 넷을 전부 부른다 — 부르는 자리를 grep 으로 확인
- 보안: 소유자가 아니면 여전히 막힌다, 주소를 직접 쳐도 AccessDenied 가 뜬다 — lib/access/extra-gate.test.ts 와 기존 소유자 확인이 그대로 통과
- 주소가 안 바뀐다, `/trading` 이 그대로 열린다 (라우트 그룹은 주소에 안 나온다)
- SERVICE_NAV·SERVICE_ROUTES·SERVICE_LABEL 셋에 trading 이 등재되고 서로 같은 글자를 쓴다
- 사이드바 하단에 나가는 문이 한 벌 서고 문구는 EXIT_TO_MAIN 한 곳에서 나온다 (N-2)
- lib/ui/nav-standard.test.ts 의 N-1 을 동일성으로 되돌리고 통과시킨다
의존: 없음

### I02 메뉴 구성 — 한 장을 여섯으로 나눈다
상태: 대기
모드: 경량
범위: apps/web/lib/trading/nav/groups.ts (신규), apps/web/app/(trading)/trading/ 하위 화면들, apps/web/lib/policy/trading-page-split.test.ts (신규), apps/web/package.json
감사 기준:
- 패널 12개가 성격별 경로로 나뉘고, 어느 화면도 패널을 열 개 넘게 쌓지 않는다
- 메뉴 항목이 둘 이상이고 한 개짜리 묶음이 없다 (N-3)
- 메뉴 이름은 lib/terms 를 지나고 사이드바가 읽는 표는 한 곳(groups.ts)이다 (N-4)
- trading-page-split.test.ts 신설: 한 화면에 쌓인 패널 수를 세고 상한을 넘으면 실패한다, 면제는 사유와 함께 적는다
- 그 가드를 일부러 깨서 실패를 확인한다
- package.json 에 등재하고 등재 뒤 총 테스트 수가 실제로 늘어난 것을 확인한다
의존: I01

### I03 설정을 화면에서 고친다
상태: 대기
모드: 중량
범위: apps/web/app/(trading)/trading/settings/page.tsx (신규), apps/web/app/(trading)/trading/settings/SettingsClient.tsx (신규), apps/web/app/api/trading/settings/route.ts (신규), apps/web/lib/trading/settings/edit.ts (신규), apps/web/lib/policy/trading-settings-surface.test.ts (신규), apps/web/package.json
감사 기준:
- 보안: 새 창구다, 소유자 확인을 부르고 소유자가 아니면 403 이다, 서비스롤 자리 위에 사람 확인이 있다, apps/web/lib/policy/api-auth-surface.test.ts 통과
- 보안: 밖에서 온 값은 key 와 value 둘이고 레지스트리에 있는 key 만 받는다, 형과 범위는 validateSetting 이 보고 거절 사유를 돌려준다 — 모르는 key 는 저장 안 함
- 보안: 새 모듈 맨 위에 import 'server-only' 가 있다
- 저장은 saveTradingSetting 을 지난다, trading_settings 를 직접 insert 하지 않는다 — grep 으로 확인
- 묶음 15개가 절로 서고 값 88개가 형에 맞는 입력칸으로 그려진다 (참/거짓·숫자·글자·고르기)
- 고친 값이 다음 판으로 쌓이고 새로고침 뒤 그 값이 보인다, 판 번호가 하나 오른다
- 거절된 값은 사유가 화면에 뜨고 저장 전 값이 그대로 남는다
- 바꾼 사람과 사유가 판에 남는다
- 가드를 일부러 깨서 실패를 확인하고 되돌린다
의존: I02

### I04 증권사 자격증명을 화면에서 등록한다
상태: 대기
모드: 중량
범위: apps/web/app/(trading)/trading/settings/CredentialPanel.tsx (신규), apps/web/app/api/trading/credentials/route.ts (신규), apps/web/lib/policy/trading-credential-surface.test.ts (신규), apps/web/package.json
감사 기준:
- 보안: 새 창구다, 소유자 확인을 부르고 소유자가 아니면 403 이다
- 보안: 비밀은 저장 뒤 화면으로 **다시 안 나간다**, 응답과 화면에 있는 것은 등록 여부와 등록 시각뿐이다 — 응답 본문을 grep 으로 확인
- 보안: 비밀이 코드·로그·오류 메시지에 안 적힌다, 저장은 기존 sealTradingSecret 을 지난다
- 보안: 모의와 실전 환경이 갈려 저장되고 한쪽을 지워도 다른 쪽이 안 지워진다
- 등록 뒤 화면에 등록됨과 시각이 뜨고, 등록 전에는 무엇이 없는지 말한다
- 가드를 일부러 깨서 실패를 확인하고 되돌린다
의존: I03

### I05 실브라우저로 셸 교체부터 설정 저장까지 확인한다
상태: 대기
모드: 경량
범위: (검증 전용, 코드 변경 없음 · 발견한 고장은 해당 항목으로 되돌아가 고친다)
감사 기준:
- 격리 서버(NEXT_DIST_DIR · 다른 포트)에서 소유자로 /trading 에 들어가 사이드바가 AI 트레이딩 것으로 바뀐 것을 스크린샷으로 확인한다
- 메뉴 항목을 눌러 화면이 갈리고 각 화면의 세로 길이가 지금보다 짧아진 것을 확인한다
- 설정 화면에서 값 하나를 고쳐 저장하고, 새로고침 뒤 그 값이 남아 있는 것을 확인한다
- 나가는 문을 눌러 업무 화면으로 돌아온다
- 만든 데이터(설정 판)는 확인 뒤 원래 값으로 되돌린다
의존: I04

### I06 종합 감사와 업데이트 내역
상태: 대기
모드: 경량
범위: apps/web/lib/changelog/entries.ts, 루트 package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- LOOP.md 7절 「기계가 세는 것」 다섯 줄을 실행하고 결과를 적는다, 전부 0 이다
- 버전 여섯 파일이 같은 값이고 앞 커밋보다 높다
- entries.ts 맨 위에 이번 판 블록이 있고 사용자가 체감하는 말로 적혀 있다
의존: I05

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-27) 최초 작성 (ins_0117)
- v0.1.1 (2026-09-27) I01 범위 확대 — 화면 폴더를 옮기자 그 경로를 **손으로 들고 있던 가드 여덟 개**가 한꺼번에 빨개졌다, 여덟 곳을 각자 고치면 다음에 또 여덟 곳이므로 lib/policy/app-dirs.ts 한 표를 만들어 전부 그것을 읽게 했다, 그 밖에 셸 목록·서비스 표·주석 세 곳이 옛 경로를 가리키고 있었고 사이드바 메뉴 표(lib/trading/nav/groups.ts)는 셸이 그릴 것이 있어야 해 I02 에서 당겨왔다 (audit:I01)
- v0.1.1 (2026-09-26) I01 범위 확대 — 옛 경로를 손으로 든 가드 8개를 app-dirs 한 표로, 셸이 그릴 메뉴 표를 당겨옴 (audit:I01)
