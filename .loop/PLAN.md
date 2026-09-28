# PLAN newAX: Jev 를 실제로 고를 수 있게 하고 화면이 지금 무엇을 하는지 말한다
플랜 ID: P0082
플랜 버전: v0.2.1
상태: 진행중
지시: ins_0139
목표 버전: v0.10.650
작성: 2026-09-28
시작 커밋: ddb26111

## 목표
- Jev 판단이 실제로 돈다 — 관문이 아는 모델을 화면에서 골라 저장할 수 있다
- 고를 것이 없을 때 「다른 것을 고르세요」라고 말하지 않는다
- 판단이 실패하면 왜 실패했는지 화면이 사람 말로 말한다
- 현황 맨 위 줄이 지금 무엇을 기다리는지 말한다

## 범위 밖
- 증권사 계좌 조회 실패(kis_APAC0071)와 그로 인한 SG-02 — 장중에도 계속 실패 중이라 따로 봐야 함, 이번 판은 손대지 않고 보고만 함
- 판단기 교체·검증 관문 기준 (지금 값 그대로 둠)
- 관문 모델을 우리가 고르는 일 (무엇을 쓸지는 사람이 정한다, 화면은 고를 수 있게만 함)

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 트레이딩 설정에서 Jev 모델 목록을 받아 와 고르고 저장할 수 있다 (실브라우저로 확인)
- 저장한 뒤 판단 기록에 Jev 성공 줄이 생긴다 (실데이터로 확인)
- 판단 기록의 실패 사유가 기계 글자가 아니다
- 현황 맨 위 줄이 마지막 봉 시각과 다음 갱신까지 남은 시간을 말한다

## 참조
- 실측 2026-09-28 ai_model_catalog 에 jev 모델 0개 (claude 4 · gemini 46 · groq 5 · openai 86)
- 실측 2026-09-28 관문 GET https://ai-gateway.vercel.sh/v1/models → 200, 모델 391개, id 가 `벤더/모델` 꼴
- 실측 2026-09-28 jev_model 값 gemini-3.6-flash 는 그 391개에 없음 → 판단 16번 전부 call_failed:jev_http_403
- 실측 2026-09-28 같은 키로 google/gemini-2.5-flash · openai/gpt-5-mini 는 200 이고 JSON 도 정상
- lib/ai-chat/providers/jev.ts 어댑터는 이미 `벤더/모델` 꼴을 안다, 목록을 받아 온 적이 없을 뿐
- app/(ai)/ai/actions.ts:1011 refreshModelCatalog 는 관리자 관문이라 트레이딩 소유자가 못 부른다
- app/(trading)/trading/JudgmentList.tsx:26 이 abstainReason 을 그대로 찍는다

## 항목

### I01 모델 목록 받아 오기를 관문 둘이 나눠 쓴다
상태: 통과
모드: 중량
범위: lib/ai-chat/model-catalog-refresh.ts (신규), app/(ai)/ai/actions.ts, app/(trading)/trading/settings/actions.ts, lib/ai-chat/model-catalog-refresh.test.ts (신규), apps/web/package.json
감사 기준:
- 목록을 받아 채우는 일이 순수하게 한 곳에 있고 관리자 창구와 트레이딩 창구가 그것을 함께 부른다 (같은 일을 두 벌 안 적음)
- 트레이딩 창구는 첫 줄이 tradingAccess 다 (보안: 관리자 창구를 그대로 부르지 않는다, 소유자가 관리자가 아닌 날에도 막히지 않고 반대로 소유자 아닌 사람은 못 부른다)
- 트레이딩 창구는 판단에 쓸 수 있는 공급자만 받는다 — 밖에서 온 공급자 이름은 떨어진다 (보안: 밖에서 온 값, 등재된 목록으로만 거른다)
- 키는 서버 밖으로 안 나간다 — 돌려주는 것은 받은 모델 수와 사유뿐 (보안: 비밀은 개수로만 답함)
- 관리자 창구의 지금 동작이 안 바뀐다 (기존 가드 전부 통과)
- 일부러 셋을 깨뜨려 확인한다: 관문 없이 부르기 · 아무 공급자나 받기 · 키를 응답에 싣기
의존: 없음

### I02 고를 것이 없으면 「목록을 받으세요」라고 말한다
상태: 통과
모드: 경량
범위: lib/trading/settings/model-pick.ts, lib/trading/settings/model-pick.test.ts, app/(trading)/trading/settings/ModelPickField.tsx
감사 기준:
- 그 공급자의 모델이 0개면 「다른 모델을 고르세요」가 아니라 「목록을 아직 안 받았습니다」와 받는 길을 말한다 (지금 화면은 고를 것이 없는데 고르라고 한다)
- 관문처럼 이름이 `벤더/모델` 꼴인 공급자는 그 사실을 함께 말한다 — 지금 값이 그 꼴이 아니면 그것이 이유다
- 목록 받기 단추가 화면에 있고 눌러서 그 자리에서 채워진다 (창을 다시 열지 않아도 됨)
- 목록이 0개인 것과 이름이 안 맞는 것을 갈라 말한다 — 둘의 조치가 다르다
의존: I01

### I02a 같은 말이 두 뜻으로 쓰이지 않는다 — Jev 가 무엇인지 화면이 말한다
상태: 통과
모드: 경량
범위: lib/trading/jev-labels.ts, lib/trading/settings/registry.ts, lib/trading/judgment-labels.ts, lib/trading/settings/model-pick.test.ts
감사 기준:
- 「Jev」가 판단기 이름인지 공급자 이름인지를 화면이 헷갈리게 두지 않는다 — 판단기 쪽은 무엇을 하는 것인지로 부르고, 공급자 쪽은 관문이라는 사실을 적는다
- 판단 모델 공급자·판단 모델 설정 설명이 「무엇을 정하는 값인지」를 말한다 (사용자 질문 2026-09-28 「jev에도 모델명이 있다고? 그냥 jev 자체 아닌가?」)
- 화면에 한글을 직접 안 적는다 — 말은 라벨 모듈에 둔다 (기존 가드 유지)
- 설정 이름에 벤더를 박지 않는다 (기존 가드 유지)
의존: 없음

### I03 판단이 왜 실패했는지 화면이 사람 말로 말한다
상태: 통과
모드: 경량
범위: lib/trading/judgment-labels.ts, lib/trading/judgment-labels.test.ts (신규), app/(trading)/trading/JudgmentList.tsx, app/(trading)/trading/judgments/page.tsx, apps/web/package.json
감사 기준:
- call_failed:jev_http_403 같은 표식이 사람 말 한 줄로 바뀐다 (모르는 표식은 버리지 않고 접어 둔다, I02 판의 run-reason 과 같은 규칙)
- 403·401·429·404 를 갈라 말한다 — 넷의 조치가 다르다 (권한·키·한도·이름)
- 같은 실패가 이어지면 표 위에서 한 줄로 요약한다 — 표만 보고 「정상인가」를 사람이 세지 않게
- 성공한 판단만 있으면 그 요약 줄이 안 뜬다 (늘 뜨는 경고는 안 읽힌다)
- pnpm test 에 등재되고 총 시험 수가 늘어난다
의존: 없음

### I04 현황 맨 위 줄이 지금 무엇을 기다리는지 말한다
상태: 통과
모드: 경량
범위: app/(trading)/trading/LiveRefresh.tsx, app/(trading)/trading/LiveRefresh.module.css, app/(trading)/trading/page.tsx, lib/trading/chart/series.ts, lib/trading/chart/series.test.ts
감사 기준:
- 마지막 봉 시각과 그 봉이 몇 초 전 것인지를 말한다 (1분 봉이라 데이터는 1분에 한 번 바뀐다 — 그 사실을 화면이 말한다)
- 다음 다시 읽기까지 남은 시간이 1초마다 움직인다 (살아 있다는 것이 눈에 보여야 한다)
- 그 1초짜리 셈이 서버를 안 두드린다 (화면 안에서만 센다)
- 탭이 뒤에 있으면 여전히 안 읽는다 (앞 판의 규칙이 안 깨진다)
의존: 없음

### I04a 증권사가 거절한 이유를 사람이 읽을 수 있게 남긴다
상태: 통과
모드: 중량
범위: lib/trading/broker/kis-request.ts, lib/trading/broker/kis-client.ts, lib/trading/broker/account.ts, lib/trading/broker/kis-client.test.ts
감사 기준:
- 증권사가 거절하면 그쪽이 준 설명(msg1)을 시스템 로그에 남긴다 — 지금은 코드만 남아 무엇이 문제인지 알 길이 없다 (실측 kis_APAC0071 이 사흘째 같은 자리에서 반복)
- 사용자에게 가는 응답에는 여전히 코드만 간다 (보안 S3: 증권사 문구에 계좌·내부 구조가 섞여 나올 수 있어 화면으로 안 내보낸다)
- 로그에 적히는 값도 비밀 가리기를 지난다 (보안: recordSystemEvent 의 maskSecrets 를 그대로 씀)
- 기록이 실패해도 조회를 막지 않는다 (감사가 사용자 동작을 막지 않는다)
- 일부러 셋을 깨뜨려 확인한다: 설명을 응답에 싣기 · 로그에 안 남기기 · 기록 실패가 조회를 막게 하기
의존: 없음

### I05 종합 감사와 업데이트 내역
상태: 통과
모드: 경량
범위: apps/web/lib/changelog/entries.ts, .loop/PLAN.md
감사 기준:
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 네 개 전부 통과 (결과를 PLAN.md 에 적음)
- LOOP.md 7절 「기계가 세는 것」 다섯 줄을 실제로 실행하고 결과가 전부 0
- 시작 커밋부터 HEAD 까지의 diff 에 범위 밖 변경·비밀 없음
- 사용자 체감 변경이 entries.ts 맨 위 이번 버전 블록에 적힌다
의존: I01, I02, I02a, I03, I04, I04a

## 종합 감사
실행 2026-09-28, 시작 커밋 ddb26111 .. HEAD v0.10.655

### 넷 다 돌렸다
- `pnpm tsc --noEmit` 통과 (오류 0)
- `pnpm lint` 통과 (오류 0, 경고 6은 이 판 전부터 있던 것)
- `pnpm test` 통과 — 8172/8172, 실패 0 (시작 8136 → 8172, +36)
- `NEXT_DIST_DIR=.next-loop pnpm build` 통과 — Compiled successfully in 92s, 오류 0
  (힙을 8G 로 올려서 냈다. 끝나고 next-env.d.ts·tsconfig.json 을 되돌렸다)

### 완료 정의 한 줄씩
- 트레이딩 설정에서 목록을 받아 고르고 저장할 수 있다 — 실브라우저로 끝까지 함:
  「목록을 아직 안 받았습니다」 → 단추 → 「342개를 받았습니다」 → Jev 탭에 모델 뜸 →
  고르고 저장 → 「jev · google/gemini-2.5-flash 로 저장했습니다」
- 저장한 뒤 판단 기록에 성공 줄이 생긴다 — **실데이터로 확인**:
  12:20 까지 403 → 대기 시간을 20초로 올린 뒤 12:37 에 첫 성공(p_short 0.85) →
  오늘 AI 판단 29건 중 4건 성공, 화면에 「AI 판단 · 롱 85% · 기록됨」으로 뜬다
- 판단 기록의 실패 사유가 기계 글자가 아니다 — call_failed 원문 0건,
  「AI 가 10초 안에 답을 안 줘서 건너뛰었습니다 — 설정의 판단 대기 시간을 늘리거나…」
- 현황 맨 위 줄이 마지막 봉 시각과 남은 시간을 말한다 —
  「마지막 봉 오후 12:52·27초 뒤 다시 읽습니다」 → 4초 뒤 「23초 뒤」

### 보안 다섯 줄 (LOOP.md 7절)
psql -f docs/policy/security-count.sql 결과 전부 0
(RLS 꺼진 표 0 · anon 쓰기 표 0 · TO public USING(true) 0 · search_path 없는 SECURITY DEFINER 함수 0 · anon 이 읽는 SECURITY DEFINER 뷰 0)

### 전체 diff
git diff ddb26111..HEAD --stat 28개 파일, +1149 / -175
- 범위 밖 변경 없음 — 바뀐 파일이 전부 I01~I05 의 범위이거나 버전 파일 다섯이다
- 비밀 없음 — 추가된 줄에 진짜 키 꼴 0건

### 실데이터로 고친 값 둘 (되돌릴 수 있어 묻지 않고 함)
- jev_model v4: google/gemini-2.5-flash, 오늘부터.
  사유를 trading_settings.reason 에 적었다 — 관문에 없는 이름이라 403 이었다
- jev_timeout_seconds v2: 20초, 오늘부터.
  관문 실측 응답이 6.1~6.4초인데 10초에서 전부 시간 초과였다

### 아직 막혀 있는 것 (이번 판이 볼 수 있게만 함)
- kis_APAC0071 이 2026-09-26 부터 매분 반복되고 broker_fail 이 쌓여
  안전 게이트 SG-01·SG-02·SG-08·SG-12 가 닫혀 있다 → 신호 0건
- I04a 가 증권사가 준 설명을 시스템 로그에 남기게 했으므로, **배포 뒤** 그 로그를 읽으면
  무엇이 문제인지 알 수 있다. 지금은 코드만 있어 아무도 못 고치는 상태였다

## 변경 이력
- v0.1.0 (2026-09-28) 최초 작성 (ins_0139)
- v0.2.0 (2026-09-28) 사용자가 「jev에도 모델명이 있다고? 그냥 jev 자체 아닌가?」라고 물었다. 같은 낱말이 판단기 이름과 공급자 이름 두 뜻으로 쓰이고 있어 화면만 읽어서는 무엇을 정하는 값인지 알 수 없다. 그 말을 가르는 항목 I02a 를 끼움 (iv_0123)
- v0.2.1 (2026-09-28) 신호가 0건인 진짜 원인이 kis_APAC0071 이고, 그 코드만으로는 무엇이 문제인지 아무도 모른다. 증권사가 준 설명을 시스템 로그에 남기는 항목 I04a 를 끼움 (audit:I04)
