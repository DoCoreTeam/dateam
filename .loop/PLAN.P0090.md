# PLAN newAX: 서버에 닿지 않으면 화면이 그렇다고 말한다
플랜 ID: P0090
플랜 버전: v0.1.1
상태: 진행중
지시: iv_0159
목표 버전: v0.10.724
작성: 2026-09-30
시작 커밋: 3979a57d

## 목표
- 서버에 닿지 않는 동안 화면이 **닿지 않는다고 말한다** — 지금은 어제 그려진 화면이 멀쩡히 살아 있는 것처럼 보이고, 눌러야 비로소 죽은 줄 안다
- 창구가 통째로 안 닿을 때 사용자가 보는 말이 「Failed to fetch」가 아니다

## 범위 밖
- 서비스 워커 캐시 규칙 변경 — 개발에서는 워커를 아예 해제하므로 이번 사고와 무관하다
- 끊긴 동안 쓴 것을 나중에 올리는 일 — 녹음 구간은 이미 `lib/offline` 이 한다
- 「Failed to fetch」가 새는 나머지 창구 전수 — 이번엔 미팅 시작 한 곳만 막고, 나머지는 배너가 먼저 말하게 한다

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 서버를 끈 채 화면을 열어 두면 배너가 뜨고, 살리면 스스로 사라진다 (실측)
- 사용자 노출 문자열은 상태 SSOT(`lib/offline/ui/sync-status.ts`)에서 온다

## 참조
- LOOP.md 7절 보안 기준 — 새 창구 하나를 연다
- apps/web/lib/policy/api-auth-surface.test.ts — 일부러 연 창구 목록
- apps/web/lib/offline/offline.test.ts — 기존 오프라인 계약 가드

## 항목

### I01 닿는지 실제로 재는 자리를 만든다
상태: 통과
모드: 경량
범위: apps/web/app/api/ping/route.ts (신규), apps/web/lib/offline/reachable.ts (신규), apps/web/lib/offline/reachable.test.ts (신규), apps/web/lib/policy/api-auth-surface.test.ts, apps/web/package.json
감사 기준:
- `GET /api/ping` 이 DB 를 한 번도 안 만지고 `{"ok":true}` 만 준다 — 응답 본문에 데이터가 0바이트
- `pingServer()` 가 던지는 fetch·응답 실패·시간 초과 셋 다에서 false 를 준다 (시험으로 셋 다 확인)
- `pnpm test reachable` 통과, `pnpm test api-auth-surface` 통과
- 보안: 이 창구는 **로그인 없이 누구나 부를 수 있다.** 그래도 되는 이유는 나가는 값이 없기 때문이다 — 인증 장치를 안 부르므로 `api-auth-surface.test.ts` 의 `OPEN_ON_PURPOSE` 에 이유와 함께 적고, 응답 본문이 `{"ok":true}` 한 가지로 고정되어 사용자·워크스페이스·판 번호가 새지 않음을 시험이 센다. 서비스롤을 쓰지 않고 DB 를 안 만지므로 그 위에 사람 확인이 필요 없다
보안: 새 창구다 — 로그인 없이 열리고, 나가는 값이 없어서 그래도 된다 (감사 기준 마지막 줄이 이것을 센다)
의존: 없음

### I02 연결 판정을 navigator.onLine 에서 실측으로 옮긴다
상태: 통과
모드: 경량
범위: apps/web/components/ui/OfflineBar.tsx, apps/web/lib/offline/ui/sync-status.ts, apps/web/lib/offline/offline.test.ts, apps/web/e2e/offline-unreachable.spec.ts (신규)
감사 기준:
- `navigator.onLine` 이 true 여도 서버가 안 답하면 배너가 뜬다 — **밀린 것이 0건이어도 뜬다**
- 한 번 실패로는 안 뜬다 (연속 2회) — 깜빡임이 고장 신호로 읽히면 안 된다
- 서버가 살아나면 아무것도 안 눌러도 배너가 사라진다
- 기존 가드 「잃을 것이 없으면 연결 없음을 안 띄운다」를 **닿을 때에 한정**하도록 고치고, 고친 이유를 시험 주석에 적는다
- `pnpm test offline` 통과
- **실브라우저로 본다** — 로그인한 화면에서 `/api/ping` 을 끊으면 배너가 뜨고, 다시 이으면 스스로 사라진다 (e2e 1건)
보안: 해당 없음 — 화면 판정과 말만이다
의존: I01

### I03 창구가 안 닿을 때 「Failed to fetch」를 사용자에게 보이지 않는다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/ui/start-meeting.ts, apps/web/lib/crm/ui/start-meeting.test.ts
감사 기준:
- fetch 가 던지면 사용자에게 가는 말이 한국어이고 **무엇을 하면 되는지**를 담는다
- 서버가 답했는데 실패한 경우(4xx·5xx)의 말은 그대로다 — 두 실패를 한 말로 뭉개지 않는다
- `pnpm test start-meeting` 통과
보안: 해당 없음
의존: 없음

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-30) 최초 작성 (iv_0159)
- v0.1.1 (2026-09-30) I02 를 실브라우저로도 본다 — 화면 판정을 고치는 항목인데 근거가 소스 읽기뿐이면 「그려지는가」를 못 센다. /api/ping 을 끊었다 잇는 e2e 1건을 범위에 넣는다 (audit:I02)
