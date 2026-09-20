# PLAN newAX: 시스템 로그가 사실과 다른 말을 하고 있었다 — 사유·조언·환경을 바로잡는다
플랜 ID: P0039
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0049
목표 버전: v0.10.303
작성: 2026-09-20
시작 커밋: 659a2866

## 목표
- 시스템 로그 아홉 줄을 원문과 대조한 결과, 고장 자체보다 **로그가 사실과 다르게 말하는 것**이 문제였음
- 관리자가 화면만 보고 옳은 일을 하게 만듦: 원인 미상 267건에 원인을 붙이고, 모델을 바꿔도 안 풀리는 한도에 모델을 바꾸라고 하지 않고, 로컬에서 난 일을 운영이 막혔다고 말하지 않음

## 범위 밖
- AI 키 한도 자체를 늘리거나 공급자를 추가하는 일 (로그가 옳게 말하고 있고, 그것은 결제·계정 판단)
- ci-discover 호출 감축 (P0030 에서 예산 게이트가 09-20 14:12 결선됨, ci-discover 는 05:55 이후 미실행이라 아직 시험 안 됨 — 다음 실행 때 관측할 일)
- ci-discover 의 `server` 오분류 (09-20 04:07 v0.10.190 에서 `lastReason = 'quota'` 로 이미 고침, 마지막 발생 05:54 는 배포 시차)
- 로컬 dev 가 운영 DB 에 쓰는 것 자체를 끊는 일 (dev 에서도 이 화면이 쓰이므로 끊지 않고 갈라서 봄)

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 사유 `unknown` 인 ci_job 사건이 새 기록에서 0건이 됨 (재현 입력으로 확인)
- 웹 검색 한도 실패의 화면 문장과 원문이 같은 말을 함
- 「지금 막혀 있는 것」이 운영에서 난 일만 셈

## 참조
- LOOP.md 7절 보안 기준
- apps/web/lib/system-log/narrate.test.ts (기존 가드, 값이 가는지 보는 방식)
- 실측 근거: system_events 18,647행 · ci_job 사건 267건 전부 reason=unknown · db 사유 125건 전부 로컬

## 항목

### I01 우리말로 쓴 오류 문장을 사유로 분류한다
상태: 통과
모드: 경량
범위: apps/web/lib/system-log/reason.ts, apps/web/lib/system-log/narrate.test.ts
감사 기준:
- classifySystemReason({ message: '등록된 AI 공급자가 전부 사용량 한도에 걸렸습니다...' }) 가 'quota' 를 돌려주는 단정이 있다 (지금은 'unknown')
- 우리말 패턴이 영어 패턴보다 **뒤에** 놓여 기존 영어 판정이 안 바뀌는 단정이 있다 (429 를 담은 Prisma 오류가 여전히 'db')
- pnpm --filter web exec node --test lib/system-log/narrate.test.ts 통과
- 보안: 순수 함수의 판정만 바꾼다, 새 데이터·새 창구·외부 입력 없음 — 7절 세 질문 전부 아니오
의존: 없음

### I02 잡이 이미 아는 오류 코드를 분류기에 넘긴다
상태: 대기
모드: 경량
범위: apps/web/lib/ci/jobs/queue.ts, apps/web/lib/system-log/narrate.test.ts
감사 기준:
- queue.ts 가 `new Error(...)` 로 다시 싸면서 버리던 `input.errorCode` 를 분류기가 보는 자리로 넘긴다 (실측: ci_job 사건 267건 전부 reason=unknown 인데 코드는 context.errorCode 에 있었다)
- 가드가 **값이 가는지**를 본다 — `errorCode` 라는 이름이 파일에 있는 것으로 통과하지 않고, 분류 인자로 넘어가는 형태를 대조한다
- pnpm --filter web exec node --test lib/system-log/narrate.test.ts 통과
- 보안: 기록 경로의 인자 하나를 넘길 뿐 새 데이터·창구·외부 입력 없음 — 7절 세 질문 전부 아니오
의존: I01

### I03 원인을 모를 때 우리가 쓴 문장을 감추지 않는다
상태: 대기
모드: 경량
범위: apps/web/lib/system-log/narrate.ts, apps/web/lib/system-log/narrate.test.ts
감사 기준:
- reason 이 'unknown' 이고 사람이 읽을 수 있는 한 문장이 있으면 detailOf 가 그 문장을 쓰는 단정이 있다 (실측 원문 「이 영상의 정보를 가져오지 못했습니다. 비공개이거나 삭제되었을 수 있습니다」가 화면에서 「원인을 자동으로 알아내지 못했습니다」로 바뀌고 있었다)
- 스택·영문 예외 문자열처럼 사람 문장이 아닌 것은 기존 문구를 그대로 쓰는 단정이 있다
- pnpm --filter web exec node --test lib/system-log/narrate.test.ts 통과
- 보안: 원문은 이미 maskSecrets 를 지나 저장된 값을 쓴다, 가림이 안 된 새 경로를 열지 않음을 단정으로 확인 — 7절 셋째 질문에 해당하므로 확인함
의존: I01

### I04 웹 검색 한도에 모델을 바꾸라고 하지 않는다
상태: 대기
모드: 경량
범위: apps/web/lib/ci/ai/signals-server.ts, apps/web/lib/ai/gemini-call.ts, apps/web/lib/system-log/narrate.test.ts
감사 기준:
- signals-server.ts 가 webSearch 를 켜고 부른 실패에 `context.webSearch` 를 실어 보낸다 (실측: 92건이 「모델을 바꾸면 됩니다」라고 했는데 원문은 「모델을 바꿔도 풀리지 않습니다」였다)
- gemini-call.ts 의 기록도 같은 값을 싣는다 — 같은 성격의 자리를 한 곳만 고치지 않는다
- 가드가 세 자리(runner·signals·gemini-call)를 전부 값 기준으로 대조하고, 값을 뺀 판으로 일부러 깨뜨려 실패를 확인한 사실을 pass --notes 에 적는다
- pnpm --filter web exec node --test lib/system-log/narrate.test.ts 통과
- 보안: 기록에 불리언 하나를 더한다, 비밀·개인정보 아님 — 7절 세 질문 전부 아니오
의존: I01

### I05 로컬에서 난 일을 운영이 막혔다고 말하지 않는다
상태: 대기
모드: 경량
범위: supabase/migrations/272_system_events_env.sql (신규), apps/web/lib/system-log/record.ts, apps/web/app/api/admin/system-log/route.ts, apps/web/app/admin/system-log/SystemLogClient.tsx, apps/web/lib/system-log/narrate.test.ts
감사 기준:
- 마이그레이션이 `env` 칼럼을 더하고 RLS 를 새로 끄지 않는다 (기존 정책 셋이 그대로 남아 있음을 psql 로 확인)
- 기록이 환경을 남기고, 화면 기본값이 운영만 세며, 로컬도 골라 볼 수 있다 (실측: db 사유 125건 전부 로컬인데 화면이 「지금 막혀 있는 것 2건」이라고 빨갛게 말했다)
- pnpm --filter web exec node --test lib/system-log/narrate.test.ts 통과
- 보안: 표에 칼럼을 더하므로 S1 해당 — RLS 가 이미 켜진 표이고 정책이 그대로인지 마이그레이션 적용 뒤 psql 로 확인한다
의존: I01

### I06 판 번호를 올리고 사용자에게 보이게 한다
상태: 대기
모드: 경량
범위: package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md, apps/web/lib/changelog/entries.ts
감사 기준:
- 여섯 파일이 같은 버전을 말하고, 그 버전이 직전 커밋보다 patch 만큼 높다
- pnpm --filter web exec node --test lib/policy/version-rule.test.ts lib/policy/policy-sync.test.ts 통과
- 보안: 문서와 판 번호만 바꾼다 — 7절 세 질문 전부 아니오
의존: I05

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-20) 최초 작성 (ins_0049)
