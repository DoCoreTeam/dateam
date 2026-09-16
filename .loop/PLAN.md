# PLAN newAX: 회의 끝내기를 저장하고 뒤에서 잇는다
플랜 ID: P0008
플랜 버전: v0.1.1
상태: 진행중
지시: iv_0054
목표 버전: v0.10.32
작성: 2026-09-16
시작 커밋: 6e70bd7f

## 목표
- 회의를 끝내는 동안 화면을 나가도 정리와 5축이 끝까지 간다
- 돌아오면 「정리 중」이 보이고, 같은 회의를 두 번 눌러도 두 번 돌지 않는다
- 무엇이 됐고 무엇이 안 됐는지 나갔다 와도 읽을 수 있다

## 범위 밖
- 전사(녹음 조각 → 글) 경로 — 이미 큐와 크론으로 돌고 있고 오늘 9조각 중 8조각이 40초 안에 처리됐다
- 회의노트 전용 정리 라우트(`/api/meeting-notes/[id]/digest`)의 UI 흐름 — 여기서는 예산 인자만 지난다
- maxDuration 상한 자체를 올리는 것 — 요금제에 달렸고, 올려도 더 긴 회의에서 같은 벽을 만난다
- 5축 추출 프롬프트·판정 규칙
- 실패한 전사 구간 재시도 정책

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 기존 상수 재사용, 화면이 문장을 새로 짓지 않음
- 설정값은 env 추가 없이 DB 저장
- 네 항목 각각을 잡는 가드가 등재된 테스트 파일 안에 있음
- 실브라우저에서 끝내기 도중 화면을 나갔다 돌아와 결과가 남아 있는 것을 확인

## 참조
- LOOP.md 부록 버전 규칙
- `apps/web/lib/meeting/digest-run.ts` — 예산 장치(`makeBudget`)와 그것을 안 쓰는 호출
- `apps/web/lib/meeting/transcribe-parts.ts` — 이 저장소의 잡 드레인 원형
- `apps/web/app/api/ci/queue/drain/route.ts` — 브라우저가 큐를 때리는 이유가 적힌 곳
- 실측 근거: 2026-09-14 「시티큐브 내부 미팅」 (crm_meeting cmu0uipgj0001l704qkh0xl4h)

## 항목

### I01 정리가 예산을 넘겨 5축을 굶기던 것
상태: 통과
모드: 경량
범위: apps/web/lib/meeting/digest-budget.ts (신규), apps/web/lib/meeting/digest-budget.test.ts (신규), apps/web/lib/meeting/digest-run.ts, apps/web/lib/gemini-meeting.ts, apps/web/lib/meeting/digest-progress.test.ts, apps/web/package.json
감사 기준:
- 실측 근거: 끝내기 07:55:43 → 정리본 08:00:38(295초) → 라우트 상한 300초에 잘림. `crm_ai_run` 오늘 0건이라 5축은 시작도 못 했고 실패 기록조차 없다
- 원인: 압축 루프만 `budget.cap()` 을 쓰고, 마지막 종합 호출은 `overallTimeoutMs: DIGEST_OVERALL_MS`(240초) 고정이다(digest-run.ts:245~249). 끝내기가 준 170초를 무시한다. 메모만 있는 경로(`summarizeMeeting`)도 인자 없이 기본 120초를 쓴다
- 시간 계산을 순수 함수로 빼서 Supabase·Gemini 없이 재현한다 — `digestCallBudget(남은예산, 상한)` 이 `{ timeoutMs, overallTimeoutMs }` 를 돌려주고, 둘 다 남은 예산을 넘지 않음
- 예산이 없으면(정리 전용 라우트) 모듈 상한 그대로 — 회귀 0
- `digest-run.ts` 의 종합 호출과 메모 경로가 그 함수를 거쳐 가고, 고정 상수를 직접 넘기면 실패하는 정적 가드 포함
- 기존 가드 `digest-progress.test.ts` 가 **옛 모양을 그대로 단정하고 있었다** — 초록인 채로 사고를 고정했다. 새 모양으로 바꾸고, 빠져 있던 계약(끝내기 예산 + 5축 몫 <= 라우트 상한)을 더한다
- `node --test` 로 새 테스트 통과, 가드를 일부러 깨서 실패 확인
의존: 없음

### I02 끝내기를 잡으로 남긴다
상태: 통과
모드: 경량
범위: supabase/migrations/254_meeting_finish_job.sql (신규), apps/web/lib/crm/jobs/finish-queue.ts (신규), apps/web/lib/crm/jobs/finish-queue.test.ts (신규)
감사 기준:
- 실측 근거: `crm_meeting` 에 진행 상태 칸이 없다(열 전수 확인). 그래서 나갔다 오면 「정리 중」을 말할 수 없고, 잠금이 없어 두 번 누르면 두 번 돈다
- 표 `crm_meeting_finish_job`: 미팅당 미완 잡은 하나뿐(부분 유니크 인덱스), 단계(`stage`)와 단계 결과(`steps` jsonb)와 실패 사유를 들고, 임대(`claimed_at`)와 재시도 수를 센다
- 이미 도는 잡이 있을 때 다시 넣으면 새 행이 안 생기고 그 잡을 돌려줌 (멱등)
- 임대가 만료된 잡은 다시 집힌다 — 좀비가 영원히 잠그지 않음
- 마이그레이션을 운영 DB 에 적용하고 `\d crm_meeting_finish_job` 으로 인덱스 확인
- `node --test` 로 순수 판정(멱등·임대 만료·단계 전이) 통과
의존: 없음

### I03 잡을 굴리는 드레인
상태: 대기
모드: 경량
범위: apps/web/lib/crm/jobs/finish-drain.ts (신규), apps/web/app/api/crm/meetings/jobs/finish/route.ts (신규), apps/web/app/api/crm/meetings/[id]/finish/route.ts, vercel.json
감사 기준:
- 실측 근거: 이 저장소는 응답 뒤 실행을 보장할 방법이 없다 — Next 14.2.29 에 `after()` 가 없고 `@vercel/functions` 도 안 쓴다(ci/queue/drain/route.ts:10~12). 그래서 일을 **다음 실행**으로 넘겨야 한다
- 끝내기 POST 는 잡만 만들고 즉시 돌려준다 — 응답까지 3초 이내
- 드레인 한 회차가 한 단계씩 진행하고 그때마다 저장한다(정리 / 노트 확정 / 5축) — 도중에 끊겨도 앞 단계 결과가 남음
- 입구 둘: 브라우저(세션 인증, 자기 워크스페이스만)와 크론(`machine-auth` SSOT 재사용, 새 인증 방식 안 만듦)
- 크론은 이미 있는 2분 주기에 얹는다 — 화면을 닫아도 백스톱이 있음
- 실패해도 잡이 `실패`로 남고 사유가 읽힌다 — 오늘처럼 아무 기록 없이 사라지지 않음
- `node --test` 로 드레인 단계 전이 통과, 브라우저 입구에 서비스 토큰 이름이 등장하면 실패하는 가드 포함
의존: I01, I02

### I04 나갔다 와도 보이고 두 번 안 눌린다
상태: 대기
모드: 경량
범위: apps/web/app/(crm)/crm/meetings/[id]/MeetingDetail.tsx, apps/web/lib/crm/ui/finish-progress.ts, apps/web/lib/crm/ui/finish-progress.test.ts
감사 기준:
- 실측 근거: `finishPhase` 가 화면 안 상태뿐이라 나갔다 오면 진행 표시가 사라지고 버튼이 다시 「미팅 끝내기」로 돌아온다
- 화면이 잡 상태를 읽어 진행 중이면 버튼이 잠기고 단계 문구가 뜬다 — 문구는 기존 `finish-progress` 그대로, 새 문장 안 지음
- 끝난 잡의 단계 결과(`steps`)와 되물음이 새로고침 뒤에도 보인다
- 브라우저: 끝내기를 누르고 다른 화면으로 갔다가 돌아왔을 때 진행이 보이고, 끝난 뒤 결과가 남아 있음
- 브라우저: 진행 중에 버튼이 눌리지 않아 잡이 하나만 생김
- `node --test` 로 finish-progress 통과
의존: I03

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-16) 최초 작성 (iv_0054)
- v0.1.1 (2026-09-16) I01 범위에 digest-progress.test.ts 와 package.json 추가 — 기존 가드가 옛 모양을 단정해 버그를 고정하고 있었고, 새 테스트는 등재해야 돈다 (audit:I01)
