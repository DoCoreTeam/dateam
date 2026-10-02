# PLAN newAX: OpenAI 크레딧이 떨어진 것을 한도 도달이라 말하지 않는다
플랜 ID: P0101
플랜 버전: v0.1.2
상태: 진행중
지시: ins_0159
목표 버전: v0.10.817
작성: 2026-10-01
시작 커밋: 51c7f846

## 목표
- 모델 선택 창이 OpenAI 가 막힌 **진짜 이유(크레딧 소진 · 결제)** 를 말함, 「잠시 후 다시 확인하세요」로 덮지 않음
- 연결 테스트가 **확인한 것만** 말함, 목록만 받아 놓고 「120개 모델 사용 가능」이라고 하지 않음
- 계정이 막힌 것을 알아채 모델 수만큼 실호출을 때리지 않음 (실측 91개 전부에 호출)

## 범위 밖
- OpenAI 결제·크레딧 충전 자체 (사용자가 공급자 콘솔에서 할 일)
- jev 342개가 unknown 인 것, gemini 7개가 400 으로 unknown 인 것 (다른 원인, 별도 플랜)
- 모델 선택 창의 배치·디자인 변경

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 모델 선택 창의 OpenAI 탭에 뜨는 사유가 「크레딧 소진 · 결제」를 가리킴 (실브라우저 확인)
- 연결 테스트 문장이 목록 받기와 실제 호출 가능 여부를 따로 말함
- 새 설정값 없음 (env 추가 없음)

## 참조
- LOOP.md 7절 보안 기준 (S3 오류 메시지에 내부 구조를 싣지 않음), 9절 U-N·F-N
- apps/web/lib/ai-chat/probe-result.ts (가용 상태 판정 SSOT)
- 실측 2026-10-01: OpenAI 가 모든 모델에 429 `insufficient_quota` / `credit_balance_exhausted`
  「You have no credits remaining」을 돌려줬고, 토큰 목록이 옛 문구만 알아 72개가 limited 로 적혔음

## 항목

### I01 계정 크레딧 소진을 한도 도달과 가른다
상태: 통과
모드: 경량
범위: apps/web/lib/ai-chat/probe-result.ts, apps/web/lib/ai-chat/probe-result.test.ts (신규), apps/web/lib/ai-chat/providers/openai-compatible.ts, apps/web/lib/ai-chat/providers/claude.ts, apps/web/package.json
감사 기준:
- 보안: 공급자 오류 원문을 화면 사유에 그대로 싣지 않음 — 고정 문장만 돌려주는지 코드로 확인 (S3)
- `classifyModelProbeFailure('OpenAI', 429, 'You have no credits remaining. Add credits to continue using the API at https://...', 'credit_balance_exhausted')` 가 availability 'unavailable' · accountLevel true 를 돌려줌
- `type: 'insufficient_quota'` 만 오고 code 가 다른 경우도 같은 판정 (getProviderErrorDetail 이 type 을 꺼냄)
- 평범한 한도 429(「Rate limit reached ... requests per min」)는 그대로 'limited'
- pnpm test probe-result 통과, 토큰 목록에서 새 값을 빼면 실패하는 것을 실제로 확인해 notes 에 적음 (S6)
의존: 없음

### I02 채팅이 결제 문제를 「잠시 후 다시」로 말하지 않는다
상태: 통과
모드: 경량
범위: apps/web/lib/ai-chat/provider-errors.ts, apps/web/lib/ai-chat/provider-errors.test.ts, apps/web/package.json
감사 기준:
- `classifyProviderError(new Error('429 You have no credits remaining. Add credits to continue using the API'))` 의 message 가 결제를 가리킴 (「잠시 후 다시 시도」가 아님)
- 같은 입력의 scope 가 'key', keyOutcome 가 'quota' 로 유지됨 (다음 키로 넘어가는 동작을 안 바꿈)
- 평범한 429 는 기존 문장 그대로
- pnpm test provider-errors 통과
의존: I01

### I02a 기다리면 풀리는 한도를 결제 문제로 바꿔 말하지 않는다
상태: 통과
모드: 경량
범위: apps/web/lib/ai-chat/probe-result.ts, apps/web/lib/ai-chat/probe-result.test.ts, apps/web/lib/ai-chat/provider-errors.ts, apps/web/lib/ai-chat/provider-errors.test.ts
감사 기준:
- 젬민 무료 등급의 「You exceeded your current quota, please check your plan and billing details」는 채팅에서 「한도」로 남음 (하루가 지나면 풀리는 것이라 결제로 말하면 안 됨)
- OpenAI 의 「no credits remaining」·credit_balance_exhausted·insufficient_quota 는 채팅에서 「결제」로 남음
- 카탈로그 프로브 쪽의 조기 중단 범위는 안 좁아짐 (애매한 옛 문구도 계정 단위로 보던 기존 동작 유지)
- pnpm test provider-quota, provider-errors, probe-result 통과
의존: I02

### I03 연결 테스트가 확인한 것만 말한다
상태: 통과
모드: 경량
범위: apps/web/lib/ai/provider-keys.ts, apps/web/lib/ai/provider-keys.test.ts, apps/web/app/admin/settings/actions.ts, apps/web/package.json
감사 기준:
- 보안: 공급자 오류 원문을 메시지에 안 실음 (기존 statusOf 규칙 유지), 키 조각이 섞여 나가지 않는지 확인 (S3)
- `describeConnectionOk` 가 「N개 모델 사용 가능」이라고 단정하지 않음 — 목록을 받았다는 사실만 말함
- 연결 테스트가 실제 생성 호출 1회를 해서 쓸 수 있는지까지 확인하고, 못 쓰면 그 사유를 말함
- pnpm test provider-keys 통과
의존: I01

### I04 화면에서 실제로 그렇게 보이는지 확인한다
상태: 통과
모드: 경량
범위: apps/web/lib/changelog/entries.ts, package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- 실브라우저로 관리자 설정 → OpenAI 모델 선택 → 모델 새로고침 → 사유가 결제를 가리키는 것을 눈으로 확인 (F-10)
- 연결 테스트를 눌러 새 문장이 뜨는 것을 확인
- 버전 파일 여섯이 같은 값, changelog 에 이번 판 블록
- pnpm test version-rule, pnpm test policy-sync 통과
의존: I01, I02, I03

## 종합 감사
- pnpm tsc --noEmit: 통과 (내 범위 0건, SuppliersTab.tsx 3건은 옆 세션 미커밋 작업)
- pnpm test: 8,815건 중 1건 실패 → I02 기인 회귀였고 I02a 로 고침, 재실행 결과는 아래
- pnpm lint / pnpm build: 아래
- 보안 재측정 (7절 「기계가 세는 것」, docs/policy/security-count.sql 실행 2026-10-02)
  - rls_off_tables 0 · anon_write_tables 0 · public_using_true_policies 0
  - unpinned_secdef_functions 0 · anon_readable_secdef_views 0 → 다섯 줄 전부 0
- 전체 diff: 내 커밋 넷(45fb56d6 · e4f1e54a · 6fbeaa11 · 6da82c7b)이 바꾼 코드 파일은 일곱
  probe-result.ts/.test.ts · provider-errors.ts/.test.ts · provider-keys.ts/.test.ts ·
  providers/openai-compatible.ts · providers/claude.ts · app/admin/settings/actions.ts
  범위 밖 변경 없음, 비밀 없음, 새 env 없음
- 실측 (2026-10-02, 운영 META 키로 직접 호출)
  - OpenAI 가 모든 모델에 429 `type=insufficient_quota` `code=credit_balance_exhausted`
    「You have no credits remaining」을 돌려줌 — 계정 크레딧이 0원인 것이 맞았음
  - 새 판정: availability=unavailable · accountLevel=true · 사유가 결제를 가리킴
  - 연결 테스트 문장: 「모델 목록 135개는 받았지만 지금 gpt-5.5 호출이 안 됩니다. OpenAI 계정의
    크레딧이 소진되었거나 결제가 설정되지 않았습니다…」
- pnpm lint: 통과 (exit 0, 경고만 — 전부 기존 것)
- pnpm build: 통과 (exit 0, 295쪽 전부 생성, NEXT_DIST_DIR=.next-settings 로 옆 세션과 안 겹치게 돌리고 tsconfig 에 붙은 내 줄은 되돌림)
- pnpm test 재실행: 아래
- 실브라우저 (로그인 세션, 관리자 설정 → AI 모델)
  - 개발 판(:3100)에서 연결 테스트 누름 → 새 문장이 빨간 경고로 뜸 ✅ (30-conn-result.png)
  - 개발 판에서 모델 새로고침(OpenAI)은 「개발 판에서는 운영 AI 키를 쓰지 않습니다」로 막힘 —
    설계대로다(lib/ai/deploy-env). 그래서 운영 빌드를 만들어 next start 로 :3300 에 올리고
    같은 길을 다시 걸음 (deploy-env 가 「Vercel 아닌 곳의 프로덕션 빌드」를 운영으로 보는 그 길)
  - 운영 판(:3300) 모델 새로고침(OpenAI) → 프로브가 돌고 카탈로그가 다시 적힘 ✅
    확인: 88줄이 「OpenAI 계정의 크레딧이 소진되었거나 결제가 설정되지 않았습니다…」,
    3줄이 「지원되지 않는 모델」, limited 0줄 (전에는 limited 72 · unavailable 19)
  - 운영 판 모델 선택 창 ✅ (60-openai-modal-final.png)
    「지금 쓰는 모델 Gpt 5.5은(는) 현재 쓸 수 없는 상태입니다 / OpenAI 계정의 크레딧이 소진되었거나
     결제가 설정되지 않았습니다…」 · 「사용 불가 91개 · 한도 도달 0개」
  - 조기 중단 확인: 91개 중 실제 벤더 호출은 계정 실패를 만난 앞의 몇 건뿐(404 3건 + 그 몇 건),
    나머지 88줄은 호출 없이 같은 사유로 채워짐
- 못 한 것: 없음 (단, 운영 배포는 사용자가 함 — push 금지 규칙)

## 변경 이력
- v0.1.0 (2026-10-01) 최초 작성 (ins_0159)
- v0.1.1 (2026-10-01) 판정 함수에 type 인자가 생겨 호출 자리(openai-compatible·claude 어댑터) 두 곳을 같이 고쳐야 함, I01 범위에 추가 (audit:I01)
- v0.1.2 (2026-10-02) 종합 감사 전 전체 시험에서 provider-quota 1건 실패, 젬민 무료 등급 429(하루면 풀림)가 I02 의 공유 목록에 걸려 결제 문제로 바뀌었음, 신호를 둘로 가르는 항목 I02a 삽입 (audit:I02)
