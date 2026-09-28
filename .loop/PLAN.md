# PLAN newAX: Jev 키를 못 보는 구멍과 장 시작 전의 거짓 고장
플랜 ID: P0081
플랜 버전: v0.1.2
상태: 진행중
지시: ins_0138
목표 버전: v0.10.645
작성: 2026-09-28
시작 커밋: 444e9bd1

## 목표
- 등록된 Jev 키가 화면에도 보이고 판단에도 실제로 쓰인다
- 장이 안 열린 시간에는 「봉을 못 불러왔다」를 고장으로 말하지 않는다

## 범위 밖
- 증권사 응답 kis_APAC0071 자체 (KIS 쪽 코드이고 우리 코드에 없음, 장이 열린 뒤 다시 봄)
- META 를 표로 옮기는 이관 자체 (옮기는 중인 상태를 그대로 두고, 그 상태에서 안 보이는 것만 고침)
- 안전 게이트 기준값 (SG-02 의 연속 실패 상한은 지금 값 그대로 둠)

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 현황의 Jev 절과 설정의 모델 고르기가 「키가 없다」를 더 말하지 않는다 (실브라우저로 확인)
- 판단기가 META 에만 있는 키로도 만들어진다
- 장 시작 전 실행 기록이 「봉을 2번까지 다시 물었지만 안 들어왔습니다」가 아니라 장 전이라는 사실을 말한다
- 창구를 새로 안 연다 — 서버 액션·API 라우트 추가 0건

## 참조
- 실측 2026-09-28 org_content.META.jev_api_key 길이 60, vck_ 로 시작, 2026-09-27 11:57 저장
- 실측 2026-09-28 ai_provider_keys 에 jev 줄 0개 (gemini 4 · groq 1 · openai 1)
- lib/ai/key-store.ts:202 firstKeyValue 가 isMetaEntry 인 줄을 걸러낸다, 그 함수를 resolveProviderKey 가 쓴다
- resolveProviderKey 호출 7곳이 전부 metaKey 에 null 을 넘긴다 (META 갈래가 죽은 코드다)
- 실측 2026-09-28 08:14 사유 bar_not_ready|bar_retry=2/2,still_missing|...|broker=failed|gate(broker_fail=9,...)
- lib/trading/jobs/tick.ts:658 bar_not_ready 가 :724 not_continuous_trading 보다 앞이라 장 전에는 뒤 가지에 못 닿는다
- 실측 2026-09-28 주말(09-26·09-27)은 no_session:weekend 로 이미 제대로 말한다, 평일 장 시작 전만 구멍

## 항목

### I01 META 에만 있는 키도 있는 키다
상태: 통과
모드: 경량
범위: lib/ai/provider-key-source.ts, lib/ai/key-store.ts, lib/ai/key-store-core.ts, lib/ai/provider-key-source.test.ts, lib/ai/key-store.test.ts
감사 기준:
- 표에 줄이 0개이고 META 에만 키가 있는 공급자에 대해 resolveProviderKey 가 apiKey 를 돌려주고 reason 이 meta 다
- 표에 줄이 있으면 그 줄이 이긴다 (META 로 안 떨어진다, 지금 동작이 안 바뀐다)
- 개발 판에서 META 키를 집는 길이 여전히 막힌다 — reason 이 env_blocked 이고 apiKey 는 null (보안: 운영 키가 개발 판으로 새지 않음, mayUseProductionKeys 가 그대로 앞에 있음)
- 키 값은 반환값 밖으로 안 나간다 — 화면·원장으로 가는 것은 개수와 사유뿐 (보안: 비밀은 있음·없음으로만 답함)
- firstKeyValue 는 그대로 표 첫 줄만 본다 (META 를 표와 맞추는 그 용도는 안 바뀐다)
- 일부러 셋을 깨뜨려 확인한다: META 줄을 다시 걸러내기 · 표 줄보다 META 를 앞세우기 · 판 검사 건너뛰기
의존: 없음

### I02 모델 고르는 자리도 「없는 키」와 「이 판에서 안 쓰는 키」를 가른다
상태: 통과
모드: 경량
범위: app/(trading)/trading/settings/actions.ts, lib/trading/settings/model-pick.ts, app/(trading)/trading/settings/ModelPickField.tsx, lib/trading/settings/model-pick.test.ts
감사 기준:
- 키가 있는데 이 판에서 안 쓰는 공급자를 「키가 없다」로 말하지 않는다 — 셋(쓸 수 있음·키 없음·이 판에서 안 씀)을 가른다
- 그 말이 현황 Jev 절과 같은 뜻이다 — 두 자리가 resolveProviderKey 의 사유 하나를 함께 본다 (각자 세지 않음)
- 고를 수 있는 탭에는 이 판에서 실제로 부를 수 있는 공급자만 선다 (부를 수 없는 것을 고르게 두면 저장은 되는데 판단이 안 돈다)
- 키 값은 화면으로 안 내려간다 — 내려가는 것은 공급자별 사유뿐 (보안: 비밀은 있음·없음을 넘는 정보를 안 줌)
- 관문은 그대로 tradingAccess 다 (보안: 소유자 확인이 창구 첫 줄에 남아 있음, 새 창구 0건)
의존: I01

### I03 장이 안 열린 시간에는 그 사실을 말한다
상태: 통과
모드: 경량
범위: lib/trading/jobs/tick.ts, lib/trading/jobs/tick-core.ts, lib/trading/jobs/tick-core.test.ts, lib/trading/operator/run-reason.ts, lib/trading/operator/run-reason.test.ts
감사 기준:
- 접속매매 시간 밖이면 봉을 묻기 전에 그 사실을 사유로 남기고 돌아간다 (야간 수집은 지금처럼 그대로 돈다)
- 그 판정이 순수 함수 한 곳에 있고 tick 이 그것을 부른다 (화면과 크론이 같은 규칙을 본다)
- 사유 표식이 사람 말 한 줄로 바뀌고 고장(빨강)이 아니라 기다리는 것으로 뜬다
- 주말·휴장일의 지금 동작(no_session)은 안 바뀐다
- pnpm test 에 등재되고 총 시험 수가 늘어난다
의존: 없음

### I04 종합 감사와 업데이트 내역
상태: 통과
모드: 경량
범위: apps/web/lib/changelog/entries.ts, .loop/PLAN.md
감사 기준:
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 네 개 전부 통과 (결과를 PLAN.md 에 적음)
- LOOP.md 7절 「기계가 세는 것」 다섯 줄을 실제로 실행하고 결과가 전부 0
- 시작 커밋부터 HEAD 까지의 diff 에 범위 밖 변경·비밀 없음
- 사용자 체감 변경이 entries.ts 맨 위 이번 버전 블록에 적힌다
의존: I01, I02, I03

## 종합 감사
실행 2026-09-28, 시작 커밋 444e9bd1 .. HEAD v0.10.647

### 넷 다 돌렸다
- `pnpm tsc --noEmit` 통과 (오류 0)
- `pnpm lint` 통과 (오류 0, 경고 6은 이 판 전부터 있던 것)
- `pnpm test` 통과 — 8136/8136, 실패 0 (시작 8116 → 8136, +20)
- `NEXT_DIST_DIR=.next-loop pnpm build` 통과 — Compiled successfully in 76s, 오류 0
  첫 시도는 SIGABRT 로 죽었다. 남아 있던 빌드 자리 둘(.next-loop 4.3G · .next-settings 1.3G)을
  치우고 `NODE_OPTIONS=--max-old-space-size=8192` 로 다시 내니 통과했다 — 코드 문제가 아니라
  메모리였다. 빌드가 고쳐 놓은 next-env.d.ts·tsconfig.json 은 되돌렸다

### 완료 정의 한 줄씩
- 현황의 Jev 절이 「키가 등록되지 않았습니다」를 더 말하지 않는다 — 실브라우저에서
  「이 판에서 쓸 Jev 키가 따로 등록되지 않았습니다」로 바뀐 것을 확인 (키를 찾았고,
  로컬은 개발 판이라 운영 키를 안 쓰는 규칙이 걸린 것이다)
- 설정의 모델 고르기도 같은 뜻으로 말한다 — 「Jev (Vercel AI Gateway) 키는 있지만
  이 판에서는 쓰지 않습니다 · 개발 판에서는 운영 AI 키를 쓰지 않습니다」
- 판단기가 META 에만 있는 키로도 만들어진다 — `createServerJevJudge` 가 쓰는
  `resolveProviderKey` 가 이제 META 줄을 센다 (운영 판에서 동작, 개발 판은 규칙대로 막힘)
- 장 시작 전 실행 기록이 장 전이라는 사실을 말한다 — `market_closed=before_open` 을 남기고
  화면이 「장이 아직 안 열렸습니다」로 읽으며 빨간색이 아니다
- 창구를 새로 안 연다 — 새 API 라우트 0개, `'use server'` 새 파일 0개

### 보안 다섯 줄 (LOOP.md 7절)
`psql -f docs/policy/security-count.sql` 실행 결과, 전부 0

| 세는 것 | 결과 |
|---|---|
| RLS 꺼진 public 표 | 0 |
| anon 이 INSERT/UPDATE/DELETE/TRUNCATE 권한을 가진 표 | 0 |
| TO public 에 USING (true) 인 정책 | 0 |
| search_path 가 안 박힌 SECURITY DEFINER 함수 | 0 |
| anon 이 읽을 수 있는 SECURITY DEFINER 뷰 | 0 |

### 전체 diff
`git diff 444e9bd1..HEAD --stat` 19개 파일, +503 / -20
- 범위 밖 변경 없음 — 바뀐 파일이 전부 I01~I04 의 범위이거나 버전 파일 다섯이다
- 비밀 없음 — 추가된 줄에 진짜 키 꼴 0건 (시험 픽스처의 `vck_from_meta` 는 지어낸 값이다)

### 실데이터로 확인한 것
- 08:45 개장 뒤 실행 사유가 `not_enough_bars:5` 로 바뀌고 `trading_bars` 에 봉이 쌓이기 시작했다
  (08:52 기준 6행). 장 전의 `bar_not_ready ... still_missing` 과 `broker=failed` 는
  장이 안 열려서였던 것이 확인됐다
- 현황 차트에 실데이터 봉 6개가 실제로 그려진다 (1113~1116 구간, 08:47~08:52)

## 변경 이력
- v0.1.0 (2026-09-28) 최초 작성 (ins_0138)
- v0.1.1 (2026-09-27) 고르는 규칙을 순수 함수로 두려는데 key-store.ts 는 맨 위가 import 'server-only' 라 시험이 못 연다. 그 함수를 isMetaEntry 옆(key-store-core.ts)으로 옮기고 그 파일을 I01 범위에 넣음 (audit:I01)
- v0.1.2 (2026-09-27) I01 을 고치고 실브라우저로 보니 상태가 둘이 아니라 셋이었다 — 쓸 수 있음·키 없음·키는 있는데 이 판에서 안 씀(운영 키 보호). 「jev 를 키 있는 공급자로 센다」는 기준은 그 셋째를 둘째로 뭉개는 말이라, 셋을 가르도록 기준을 고치고 말하는 자리(model-pick.ts·ModelPickField.tsx)를 범위에 넣음 (audit:I02)
