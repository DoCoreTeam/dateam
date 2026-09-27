# PLAN newAX: 예측이 사람에게 닿는다 — 알림 통로·도달 알림·방향 하나·백테스트 Jev·판단기 합의
플랜 ID: P0074
플랜 버전: v0.1.7
상태: 진행중
지시: ins_0128
목표 버전: v0.10.597
작성: 2026-09-27
시작 커밋: 787395a0

## 목표
- 신호와 경고가 대기 표에서 끝나지 않고 휴대폰으로 실제로 나간다
- 손절가·목표가에 닿으면, 보유 시간이 지나면 알림이 간다 (명세 §8 D-32, 채택해 놓고 안 만든 것)
- 방향을 정하는 자리가 하나가 된다, 지금은 tick 과 emit-signal 이 따로 정한다
- 백테스트가 Jev 를 실제로 돌려 성과를 잰다, 지금은 한 번도 안 부른다
- 신호가 rule 단독이 아니라 rule·jev 합의로 서고 jev 에도 보정 라인이 생긴다

## 범위 밖
- KIS 자격증명·Jev 키 등록, 사람이 화면에서 넣는 값이고 코드가 대신 못 함
- 목표가를 Jev 가 정하는 일, 명세 M3·§8·D-11 개정이 먼저
- 매분 청산 AI 알림, M2·D-11·가드·DB 검사 제약 개정이 먼저. 이번에는 규칙 기반 도달 알림만
- 실제 발송 왕복 검증, 구독 기기와 열쇠 등록이 선행
- 야간장 신호 활성화, 자동 주문 무장

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 대기 표의 알림이 구독 기기로 나가는 경로가 코드에 있고 구독이 없으면 그 사실을 사유로 남긴다
- 손절 도달·목표 도달·시간 청산이 각각 알림 종류를 갖고 규칙으로 발생한다
- 방향을 만드는 함수가 하나이고 tick 과 emit-signal 이 같은 값을 쓴다
- 검증 파이프라인이 Jev 판단기를 받을 수 있고 예산 상한과 진행 사유가 함께 남는다
- 신호 발행 단계에 판단기 합의가 있고 jev 보정·기대값을 읽는 길이 있다
- 새 비밀은 env 가 아니라 DB 에 저장하고 화면에서 관리한다
- 사용자 노출 문자열은 라벨 표를 지난다

## 참조
- newplan/TRD/AI_TRADING_SPEC.md §8 D-32 가격 도달 알림, §7.2 판단기 특권 없음, §7.4·M3 보정, §13.1 신호 백테스트, M2 발행 단계, M9 유일 키, M12 기존 AI 계층
- 설계서 v0.7.5 §7 하루 흐름, 휴대폰 푸시가 전제인데 발송 장치가 없음
- apps/web/lib/trading/notify/outbox.ts:147~152 「이 저장소에는 푸시 발송 장치가 없다」
- apps/web/public/sw.js 이미 등록돼 도는 서비스 워커, push 핸들러 0건
- apps/web/lib/trading/jobs/tick.ts directionOf(rawScore) 와 apps/web/lib/trading/jobs/emit-signal.ts input.trigger.direction, 방향이 두 곳
- apps/web/lib/trading/validation/pipeline.ts, createServerJevJudge 호출 0건
- 실측 2026-09-27 trading_job_runs 1,878건 중 765건이 no_credential, 봉·판단·신호 전부 0건

## 항목

### I01 알림 받을 기기를 등록하는 자리를 만든다
상태: 통과
모드: 중량
범위: supabase/migrations/290_trading_push.sql (신규), apps/web/lib/trading/notify/push-store.ts (신규), apps/web/lib/trading/notify/push-core.ts (신규), apps/web/lib/trading/notify/push-store.test.ts (신규), apps/web/package.json
감사 기준:
- 구독 표와 발송 열쇠 표가 같은 마이그레이션에서 RLS 가 켜진다, rls-baseline 가드 통과
- 구독 유일 키가 endpoint 기준이라 같은 기기가 두 줄이 안 된다 (M9)
- 발송 열쇠 비밀키는 기존 봉인 함수로 암호화해 저장하고 평문 칼럼이 없다 (S3)
- 읽기 함수가 비밀키 원문을 화면 쪽으로 돌려주지 않는다, 있음 없음만 말한다
- 보안: 표 둘 다 RLS 켜짐과 정책 대상이 TO public 이 아님을 확인하고, 일부러 RLS 를 빼 가드가 실패하는 것을 본다 (S1·S6)
의존: 없음

### I02 휴대폰이 알림을 받을 수 있게 한다
상태: 통과
모드: 경량
범위: apps/web/public/sw.js, apps/web/lib/trading/notify/push-labels.ts (신규), apps/web/app/(trading)/trading/PushPanel.tsx (신규), apps/web/app/(trading)/trading/actions.ts, apps/web/app/(trading)/trading/page.tsx, apps/web/lib/trading/notify/push-subscribe.test.ts (신규), apps/web/package.json
감사 기준:
- 서비스 워커가 push 와 notificationclick 을 처리하고 누르면 트레이딩 화면으로 간다
- 홈 화면 추가가 되는 manifest 가 이미 있고 그대로다, 아이폰은 이것이 없으면 푸시가 아예 안 온다
- 구독 단추가 소유자 관문을 지난 서버 액션을 부르고 거절·미지원을 화면 문구로 말한다
- 화면에 붙인 말이 라벨 표에서 온다, 화면 안 라벨 표를 안 만든다
- 보안: 구독 등록 창구가 tradingAccess 를 지나고 공개 열쇠만 화면으로 내려간다
의존: I01

### I03 대기 표의 알림이 실제로 밖으로 나간다
상태: 통과
모드: 중량
범위: apps/web/lib/trading/notify/web-push.ts (신규), apps/web/lib/trading/notify/web-push.test.ts (신규), apps/web/lib/trading/notify/outbox.ts, apps/web/lib/trading/notify/outbox.test.ts, apps/web/lib/trading/jobs/watch.ts, apps/web/lib/trading/notify/push-store.ts, apps/web/lib/trading/notify/push-core.ts, apps/web/lib/trading/notify/push-store.test.ts, apps/web/package.json
감사 기준:
- flushNotifications 가 구독마다 실제 발송을 시도하고 성공·실패를 기존 시도 기록에 적는다
- 구독이 0개면 「보냈다」로 적지 않고 그 사실을 사유로 남긴다, 조용한 성공을 안 만든다
- 404·410 응답이 오면 그 구독을 지운다, 죽은 기기에 영원히 재시도하지 않는다
- 발송 실패는 기존 재시도 정책 MAX_ATTEMPTS·BACKOFF 를 그대로 지나고 행은 남는다
- 보안: 비밀키가 오류 문장·로그·응답에 안 실리는 것을 가드로 잠그고, 일부러 실어 실패를 확인한다 (S3·S6)
의존: I01

### I04 손절·목표에 닿으면, 시간이 지나면 알린다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/notify/outbox-policy.ts, apps/web/lib/trading/position/state.ts, apps/web/lib/trading/jobs/watch.ts, apps/web/lib/trading/jobs/tick.ts, apps/web/lib/trading/jobs/watch.test.ts, apps/web/lib/trading/notify/outbox.test.ts, supabase/migrations/291_trading_notify_kinds.sql (신규)
감사 기준:
- 봉 범위가 목표가에 닿으면 목표 도달 알림이 한 번 생긴다, 같은 분에 두 번 안 생긴다 (M9)
- 진입 후 시간 청산 분을 넘기면 시간 청산 알림이 한 번 생긴다
- 알림 종류가 DB 검사 제약과 같은 목록으로 늘고 급한 순서에서 손절 보호보다 뒤다 (§10.2)
- 가격 도달은 알림일 뿐이고 포지션 상태·실현 손익을 안 바꾼다 (D-32)
- 보안: 마이그레이션이 검사 제약만 바꾸고 RLS·정책을 안 건드리는 것을 확인
의존: 없음

### I05 방향을 한 곳에서 정한다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/signal/models-core.ts, apps/web/lib/trading/jobs/emit-signal.ts, apps/web/lib/trading/jobs/tick.ts, apps/web/lib/policy/trading-signal-order-guard.test.ts
감사 기준:
- 방향을 만드는 함수가 하나이고 emit-signal 이 그 값을 받아서 쓴다, 진입 조건에서 다시 안 뽑는다
- 원점수의 방향과 진입 조건의 방향이 다르면 신호가 안 나가고 그 사실이 사유에 남는다
- 가드가 emit-signal 안에서 방향을 다시 정하는 코드를 세고, 일부러 되살려 실패를 확인한다 (S6)
- 손절·목표 부호가 그 하나의 방향에서 나온다
- 보안: 해당 없음, 순수 판정이고 표·창구·외부 입력을 안 건드림
의존: 없음

### I06 백테스트가 Jev 를 돌린다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/validation/pipeline.ts, apps/web/lib/trading/validation/pipeline-core.ts, apps/web/lib/trading/validation/pipeline-core.test.ts, apps/web/lib/trading/settings/registry.ts
감사 기준:
- 검증 파이프라인이 jev 판단기를 받아 돌릴 수 있고 안 받으면 지금처럼 rule·ml 만 돈다
- 호출 수 상한 설정이 있고 넘으면 그 시점에 멈추고 이유를 남긴다
- 진행 사유에 판단기별 호출 수와 기권 수가 남는다
- 키나 모델이 없으면 던지지 않고 「Jev 없이 돌았다」를 결과에 적는다
- 보안: 해당 없음, 기존 AI 계층 예산·마스킹·원장을 그대로 지나가고 새 키 풀이 없음
의존: 없음

### I07 신호가 판단기 합의로 선다
상태: 통과
모드: 경량
범위: supabase/migrations/292_trading_consensus.sql (신규), apps/web/lib/trading/signal/emit.ts, apps/web/lib/trading/signal/emit.test.ts, apps/web/lib/trading/signal/store.ts, apps/web/lib/trading/signal/models-core.ts, apps/web/lib/trading/jobs/tick.ts, apps/web/lib/trading/jobs/emit-signal.ts, apps/web/lib/trading/settings/registry.ts, apps/web/lib/trading/overview-shape.ts, apps/web/lib/trading/overview-shape.test.ts, apps/web/lib/policy/trading-signal-order-guard.test.ts
감사 기준:
- 발행 단계에 판단기 합의가 판단 뒤·보정 앞에 들어가고 화면이 멈춘 단계를 그대로 읽는다
- rule 과 jev 의 방향이 다르면 합의 실패로 막히고 사유가 남는다
- Jev 가 꺼졌거나 기권한 날 어떻게 할지가 설정이고 기본값이 「신호 중단」이다
- jev 의 보정·기대값을 읽는 길이 있고 없으면 M3 대로 신호를 안 낸다
- 두 판단의 출처가 신호 행에 남는다
- 보안: 마이그레이션이 기존 표에 칼럼만 더하고 RLS·정책을 안 건드리는 것을 확인, 새 창구 0개
의존: I05

### I08 종합 감사와 업데이트 내역
상태: 통과
모드: 경량
범위: .loop/PLAN.md, apps/web/lib/changelog/entries.ts, package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 네 개 전부 통과, 결과를 PLAN.md 에 적음
- LOOP.md 7절 「기계가 세는 것」 다섯 줄을 실제로 실행하고 결과가 전부 0
- git diff 787395a0..HEAD --stat 에 범위 밖 변경·비밀 없음
- 사용자 체감 변경이 entries.ts 맨 위 이번 버전 블록에 적힌다
- 보안: 위 다섯 줄이 이 항목의 보안 감사 기준임
의존: I01, I02, I03, I04, I05, I06, I07

## 종합 감사

실행 2026-09-27, 시작 커밋 787395a0 기준

### 1 검사 넷

| 명령 | 결과 |
|---|---|
| pnpm tsc --noEmit | 통과 (오류 0) |
| pnpm lint | 통과 (오류 0) |
| pnpm test | 통과 — 시험 7,969개 전부 통과, 실패 0 |
| NEXT_DIST_DIR=.next-p0074 pnpm build | 통과 |

빌드는 격리 dist 로 돌리고 끝나고 tsconfig·next-env 를 되돌렸다

### 2 완료 정의 대조

| 완료 정의 | 확인 |
|---|---|
| 검사 넷 통과 | 위 표 |
| 알림이 구독 기기로 나가는 경로가 있다 | flushNotifications 가 sendPush 를 부르고, 받는 쪽 비밀키로 실제 복호화해 원문이 나오는 것을 시험이 확인 |
| 구독이 없으면 사유를 남긴다 | no_push_key · no_device · nothing_due 를 갈라 행과 실행 기록에 적음 |
| 손절·목표·시간 청산이 각각 종류를 갖는다 | protection_breached · target_reached · time_exit, DB 검사 제약과 같은 목록 |
| 방향을 만드는 함수가 하나다 | agreedDirection 하나, 발행 쪽이 진입 조건에서 다시 안 뽑는 것을 가드가 셈 |
| 검증이 Jev 를 받을 수 있다 | cappedJudge + 호출 상한 설정, 상한은 접기 밖에 한 번만 |
| 발행 단계에 합의가 있다 | EMIT_STAGES 가 여섯, 합의가 판단 뒤·보정 앞 |
| jev 보정을 읽는 길이 있다 | loadSignalModels judge:'jev', 합칠 때는 낮은 쪽 |
| 새 비밀은 env 가 아니라 DB | VAPID 비밀키는 마이그 290 의 봉투 칼럼, 새 env 키 0개 |
| 화면 문자열이 라벨 표를 지남 | jev-labels.ts · push-labels.ts, glossary·ui-phrases 가드 통과 |

### 3 보안 — 기계가 세는 다섯 줄

2026-09-27 운영 DB 실행 (docs/policy/security-count.sql)

| 세는 것 | 결과 |
|---|---|
| RLS 꺼진 public 표 | 0 |
| anon 이 INSERT UPDATE DELETE TRUNCATE 권한을 가진 표 | 0 |
| TO public 에 USING (true) 인 정책 | 0 |
| search_path 가 안 박힌 SECURITY DEFINER 함수 | 0 |
| anon 이 읽을 수 있는 SECURITY DEFINER 뷰 | 0 |

다섯 줄 전부 0. 새 표 둘(trading_push_subscriptions · trading_push_keys)은 적용 후 relrowsecurity·relforcerowsecurity 가 둘 다 참인 것을 실측 확인

항목별 보안 판정
- I01 중량: S1 RLS·FORCE·권한 회수, S3 평문 비밀키 칼럼 0·화면 형에 비밀키 자리 0, S4 https 만 등록. S6 셋 확인
- I02: 창구 넷이 tradingAccess 를 먼저 지나고 공개 열쇠만 내려감
- I03 중량: S3 비밀키가 사유·로그·문자열 보간에 안 실림(파일에 console 0건), S4 기기 주소가 assertSafeUrl 을 지남. S6 둘 확인
- I04·I07: 마이그레이션이 검사 제약과 칼럼만 바꾸고 RLS·정책을 안 건드림을 실측 확인
- I05·I06: 해당 없음 (순수 판정 · 기존 AI 계층 재사용)

### 4 전체 diff

git diff 787395a0..HEAD --stat — 38파일 2,409추가 61삭제

- 범위 밖 변경 없음, 파일 전부가 항목 범위(plan revise 로 정정한 것 포함) 안
- 비밀 없음 — diff 에서 키·비밀번호 꼴 0건
- 빌드가 건드린 tsconfig·next-env 는 되돌림

### 5 항목 대 결과 대조

| 항목 | 커밋 | 기획 순서 |
|---|---|---|
| I01 알림 받을 기기 자리 | 060a2606 | P3 |
| I02 휴대폰이 받게 | ec69acae | P3 |
| I03 실제로 밖으로 | e443ad29 | P3 |
| I04 목표·시간 알림 | 9d4e59b5 | D-32 |
| I05 방향 하나 | 576035f7 | 0 |
| I06 백테스트에 Jev | 61e15344 | ⑥ |
| I07 판단기 합의 | 4c3e9024 | ① |

어제 기획의 승인 대기 일곱 중 다섯이 이 플랜이고, 나머지 둘(P1·P2)은 앞 플랜 P0073 에서 끝냈다

### 6 발견 사항

- **단계 이름 접두사가 뒤의 것을 가로챘다.** `judge` 와 `judge_consensus` 를 배열 순서로 찾으면 앞의 것이 먼저 맞아, 합의에서 멈춘 분이 화면에 「판단에서 멈춤」으로 떴다. 긴 것부터 맞추게 고쳤다
- **가드가 숫자를 박아 두고 있었다.** 발행 단계가 다섯이라는 단정이 셋 있었고 단계가 늘자 전부 걸렸다. 값에서 뽑게 바꿔 다음에 늘어도 규칙이 남게 했다
- **app/manifest.ts 가 이미 있었다.** 없는 줄 알고 덮어썼다가 되돌렸다 — standalone·동적 상호·아이콘까지 갖춰져 있었고 할 일은 서비스 워커뿐이었다
- **배선 가드가 쓴 곳 없는 내보내기 셋을 잡았다.** 만들어 놓고 안 부르는 함수는 안 도는 코드다, 지웠다
- 이 플랜도 Jev 를 켜지는 못한다. KIS 자격증명·Jev 키·모델 이름은 사람이 화면에서 넣는 값이다

## 변경 이력
- v0.1.0 (2026-09-27) 최초 작성 (ins_0128)
- v0.1.3 (2026-09-27) I02 범위에서 manifest 와 아이콘을 뺐다 — app/manifest.ts 가 이미 있었고 standalone·동적 상호·아이콘까지 다 갖춰져 있었다. 없는 줄 알고 덮어썼다가 되돌렸다, 할 일은 서비스 워커와 구독 자리뿐이었다 (audit:I02)
- v0.1.2 (2026-09-27) I01 범위에 push-core.ts 추가 — 열쇠를 다루는 모듈은 server-only 라 시험이 들여올 수 없고, 값으로 확인할 셈은 밖에 둬야 실제로 돌려 볼 수 있다 (audit:I01)
- v0.1.1 (2026-09-27) 마이그레이션 번호 정정 286·288·289 -> 290·291·292, 이미 쓰인 번호였다 (audit:I01)
- v0.1.1 (2026-09-27) 마이그레이션 번호 정정 286·288·289 -> 290·291·292, 이미 쓰인 번호였다 (audit:I01)
- v0.1.2 (2026-09-27) I01 범위에 push-core.ts 추가 — 열쇠를 다루는 모듈은 server-only 라 시험이 들여올 수 없고, 값으로 확인할 셈은 밖에 둬야 실제로 돌려 볼 수 있다 (audit:I01)
- v0.1.3 (2026-09-27) I02 범위 정정 — manifest 는 상호를 설정에서 읽어야 해서 app/manifest.ts 로 만들었고 아이콘은 gitignore 가 png 를 막아 SVG 로 넣었다, layout.tsx 는 Next 가 자동으로 걸어 안 건드렸다 (audit:I02)
- v0.1.7 (2026-09-27) I07 범위에 models-core.ts 와 화면·순서 가드 둘 추가 — jev 보정 라인을 합치는 셈이 방향 함수 옆에 있어야 하고, 단계가 하나 늘자 다섯을 숫자로 박아 둔 단정 셋이 걸렸다. 그 과정에 진짜 결함 하나를 찾았다: 단계 이름 접두사가 겹치면 앞의 것이 뒤의 것을 가로채 합의에서 멈춘 분이 화면에 「판단에서 멈춤」으로 떴다 (audit:I07)
- v0.1.6 (2026-09-27) I04 범위 정정 — 판정은 detectBreach 옆(position/state.ts)에 두는 것이 맞아 watch-plan.ts 대신 그 파일을 넣었고, 종류 목록 가드가 282 한 파일만 읽어 제약을 넓힌 판을 못 봐 outbox.test.ts 도 고쳤다 (audit:I04)
- v0.1.5 (2026-09-27) I03 범위에 watch.ts 와 I01 파일 셋 추가 — 안 나간 이유를 실행 기록에 실어야 「0건 보냄」이 고장과 구분되고, 배선 가드가 I01 에서 쓴 곳 없이 내보낸 함수 셋을 잡아 지웠다 (audit:I03)
- v0.1.4 (2026-09-27) I02 범위에서 manifest 와 아이콘을 뺐다 — app/manifest.ts 가 이미 있었고 standalone·동적 상호·아이콘까지 갖춰져 있었다, 없는 줄 알고 덮어썼다가 되돌렸다 (audit:I02)
- v0.1.5 (2026-09-27) I03 범위에 watch.ts 와 I01 파일 셋 추가 — 안 나간 이유를 실행 기록에 실어야 0건 보냄이 고장과 구분되고, 배선 가드가 쓴 곳 없이 내보낸 함수 셋을 잡아 지웠다 (audit:I03)
- v0.1.6 (2026-09-27) I04 범위 정정 — 판정은 detectBreach 옆(position/state.ts)에 두는 것이 맞아 watch-plan.ts 대신 그 파일을 넣었고, 종류 목록 가드가 282 한 파일만 읽어 제약을 넓힌 판을 못 봐 outbox.test.ts 도 고쳤다 (audit:I04)
- v0.1.7 (2026-09-27) I07 범위에 models-core.ts 와 화면·순서 가드 둘 추가 — 단계가 하나 늘자 다섯을 숫자로 박아 둔 단정 셋이 걸렸고, 그 과정에 단계 이름 접두사가 겹쳐 앞의 것이 뒤의 것을 가로채는 진짜 결함을 찾았다 (audit:I07)
