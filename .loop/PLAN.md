# PLAN newAX: 판단 모델을 우리가 가진 키로 부른다 — 공급자 선택과 키 교체
플랜 ID: P0075
플랜 버전: v0.1.2
상태: 진행중
지시: ins_0132
목표 버전: v0.10.606
작성: 2026-09-27
시작 커밋: 5fc33493

## 목표
- 판단 모델을 Vercel 관문 말고 이미 가진 Gemini 유료 키로도 부를 수 있다
- 키가 한도에 걸리면 다음 키로 이어 부른다, 지금은 첫 키 하나만 쓴다
- 어느 공급자로 부르는지가 화면에서 보이고 설정에서 바뀐다

## 범위 밖
- 새 공급자 추가 (지금 목록 여섯 안에서만 고름)
- Gemini 네이티브 SDK 경로 (OpenAI 호환 창구만 씀, 판단 호출은 JSON 한 번이라 그것으로 족함)
- 모델 이름을 화면에서 목록으로 고르는 기능 (지금처럼 글자로 적음)
- KIS 자격증명, 3문항 초기 설정 화면

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 설정 하나로 판단 공급자를 바꿀 수 있고 기본값은 지금 동작(jev)과 같다
- 고른 공급자의 주소와 키로 부르고, 원장에도 그 공급자 이름으로 적힌다
- 키가 한도·오류에 걸리면 다음 키로 이어 부르고 결과가 키마다 기록된다
- 공급자에 OpenAI 호환 주소가 없으면 판단기를 아예 안 만든다 (반쯤 된 판단기 금지)
- 실측 2026-09-27 로 확인한 사실이 설정 도움말에 들어간다 (Vercel 무료 등급은 좋은 모델이 403)

## 참조
- newplan/TRD/AI_TRADING_SPEC.md §7.2 판단기 특권 없음, §17.1 기존 AI 계층, M12
- apps/web/lib/trading/judge/jev.ts — 'jev' 가 세 곳에 박혀 있음 (주소·원장·키)
- apps/web/lib/ai/key-rotation.ts withProviderKeys — 키 교체 SSOT
- packages/ai-providers/src/vendor.ts — GEMINI.baseUrl 이 null (SDK 를 쓰는 공급자라서)
- 실측 2026-09-27: Vercel 무료 등급은 anthropic·google 모델이 전부 403. Gemini 유료 키는 44개 모델 전부 열림
- 실측 2026-09-27: gemini-3.8-flash 가 세 문제 3/3, 두 번 물어도 같은 답, 2.1~4.5초

## 항목

### I01 판단기가 어느 공급자를 부를지 고른다
상태: 통과
모드: 경량
범위: packages/ai-providers/src/vendor.ts, apps/web/lib/ai/provider-catalog.ts, apps/web/lib/trading/judge/jev.ts, apps/web/lib/trading/judge/jev.test.ts, apps/web/lib/trading/judge/exit-jev.ts, apps/web/lib/trading/judge/exit-jev.test.ts, apps/web/lib/trading/jobs/knowledge-job.ts, apps/web/lib/trading/validation/pipeline.ts, apps/web/lib/trading/settings/registry.ts, apps/web/lib/trading/jobs/tick.ts
감사 기준:
- 설정 하나로 공급자가 바뀌고 기본값이 jev 라 지금 동작이 안 바뀐다
- 고른 공급자의 OpenAI 호환 주소로 부르고 원장 공급자 이름도 그것이 된다
- OpenAI 호환 주소가 없는 공급자를 고르면 판단기를 안 만들고 사유를 남긴다
- Gemini 의 OpenAI 호환 주소가 벤더 명세에 있고 기존 baseUrl 의 뜻을 안 바꾼다
- 보안: 주소가 벤더 명세 상수에서만 오고 설정값이 주소에 안 섞인다 (S4), 일부러 설정에서 주소를 받게 고쳐 가드 실패 확인 (S6)
의존: 없음

### I02 키가 막히면 다음 키로 이어 부른다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/judge/jev.ts, apps/web/lib/trading/judge/jev.test.ts, apps/web/lib/trading/judge/exit-jev.ts, apps/web/lib/policy/ai-key-rotation-guard.test.ts
감사 기준:
- 판단 호출이 withProviderKeys 를 지나 키가 막히면 다음 키로 이어진다
- 키마다 결과가 기록돼 last_used_at 이 도는 것이 보인다
- 모델 쪽 실패(404·400)로는 키를 안 태운다, 계정 쪽 실패(429·401)에서만 다음 키로 간다
- 키 원문이 오류 문장·원장에 안 실린다
- 보안: 교체가 기존 SSOT(withProviderKeys)를 지나는 것을 가드가 세고, 일부러 직접 부르게 고쳐 실패를 확인한다 (S6)
의존: I01

### I03 종합 감사와 업데이트 내역
상태: 통과
모드: 경량
범위: .loop/PLAN.md, apps/web/lib/changelog/entries.ts, package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 네 개 전부 통과 (결과를 PLAN.md 에 적음)
- LOOP.md 7절 「기계가 세는 것」 다섯 줄을 실제로 실행하고 결과가 전부 0
- git diff 5fc33493..HEAD --stat 에 범위 밖 변경·비밀 없음
- 사용자 체감 변경이 entries.ts 맨 위 이번 버전 블록에 적힌다
- 보안: 위 다섯 줄이 이 항목의 보안 감사 기준임
의존: I01, I02

## 종합 감사

실행 2026-09-27, 시작 커밋 5fc33493 기준

### 1 검사 넷

| 명령 | 결과 |
|---|---|
| pnpm tsc --noEmit | 통과 (오류 0) |
| pnpm lint | 통과 (오류 0) |
| pnpm test | 통과 — 시험 7,979개 전부 통과, 실패 0 |
| NEXT_DIST_DIR=.next-p0075 pnpm build | 통과 |

### 2 완료 정의 대조

| 완료 정의 | 확인 |
|---|---|
| 검사 넷 통과 | 위 표 |
| 설정 하나로 공급자가 바뀌고 기본이 지금 동작 | `jev_provider` 기본값 jev, 가드가 확인 |
| 고른 공급자의 주소·키로 부르고 원장도 그 이름 | `providerId: provider`, 가드가 양쪽 확인 |
| 키가 막히면 다음 키로 이어 부른다 | 가짜 키 넷으로 실행 확인 (429 4번·503 2번·404 1번·단일 1번) |
| 호환 주소 없으면 판단기를 안 만든다 | `openAiCompatibleBaseUrl` 이 null 이면 던짐 |
| 실측이 설정 도움말에 들어감 | jev_provider·jev_model 도움말에 2026-09-27 실측 기재 |

### 3 보안 — 기계가 세는 다섯 줄

2026-09-27 운영 DB 실행, 다섯 줄 전부 0

| 세는 것 | 결과 |
|---|---|
| RLS 꺼진 public 표 | 0 |
| anon 쓰기 권한 표 | 0 |
| TO public 에 USING (true) 정책 | 0 |
| search_path 안 박힌 SECURITY DEFINER 함수 | 0 |
| anon 이 읽는 SECURITY DEFINER 뷰 | 0 |

이번 판은 표를 안 만들고 정책도 안 건드렸다. 보안 판정은 S4 하나다 —
**주소가 벤더 명세 상수에서만 오고 설정값이 주소에 안 섞인다.** 가드로 잠갔고
일부러 주소를 지어내게 고쳐 실패를 확인했다

### 4 전체 diff

git diff 5fc33493..HEAD --stat — 16파일 300추가 40삭제. 범위 밖 변경 없음, 비밀 없음

### 5 항목 대 결과 대조

| 항목 | 커밋 |
|---|---|
| I01 공급자 선택 | 084c3488 |
| I02 키 교체 | 56c5402a |

### 6 발견 사항

- **Vercel 관문 무료 등급은 좋은 모델이 전부 403 이다.** anthropic·google 모델이 「Free tier users do not have access」였고, 정작 우리 Gemini 유료 키는 44개 모델이 다 열렸다. 코드가 벤더를 박아 두면 그 사실을 알아도 못 쓴다
- **기존 교체 가드는 `.streamChat(` 만 셌다.** 어댑터를 안 쓰고 창구를 직접 여는 자리(트레이딩 판단기 둘)가 규칙 밖에 있었다. 창구를 직접 여는 파일도 세게 넓혔고, 그 자리에서 청산 Jev 가 첫 키로 끝내던 것을 잡았다
- **진입만 고치면 갈린다.** 「청산이 진입과 같은 키·같은 예산·같은 원장을 쓴다」 가드가 그것을 잡았다. 가드가 글자(`getProviderSpec('jev')`)를 보고 있어서 양쪽이 박혀 있을 때는 저절로 참이었다 — 「둘 다 받아서 쓰는가」로 바꿨다
- 모델 고르기는 여전히 사람이 글자로 적는다. gemini-3.8-flash 가 2.8초에 합 1.000 으로 답하는 것을 실제 경로로 확인했다

## 변경 이력
- v0.1.0 (2026-09-27) 최초 작성 (ins_0132)
- v0.1.2 (2026-09-27) I02 범위에 exit-jev.ts 추가 — 새로 넣은 가드가 청산 쪽도 첫 키로 끝내고 있는 것을 잡았다, 진입만 고치면 둘의 성적이 다른 조건의 것이 된다 (audit:I02)
- v0.1.1 (2026-09-27) I01 범위에 청산 Jev·지식 일·검증·공급자 목록 추가 — 진입만 고치자 「청산과 같은 키·같은 예산을 쓴다」 가드가 갈린 것을 잡았다. 주소 고르는 함수는 목록 쪽이 제 집이라 거기 뒀다(server-only 밖이라 시험이 실제로 돈다) (audit:I01)
- v0.1.1 (2026-09-27) I01 범위에 청산 Jev·지식 일·검증·공급자 목록 추가 — 진입만 고치자 청산과 같은 키를 쓴다는 가드가 갈린 것을 잡았다 (audit:I01)
- v0.1.2 (2026-09-27) I02 범위에 exit-jev.ts 추가 — 새 가드가 청산 쪽도 첫 키로 끝내는 것을 잡았다 (audit:I02)
