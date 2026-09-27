# PLAN newAX: 설정 화면의 말과 꼴을 규정대로 되돌린다
플랜 ID: P0078
플랜 버전: v0.2.3
상태: 진행중
지시: ins_0135
목표 버전: v0.10.618
작성: 2026-09-27
시작 커밋: a3a26602

## 목표
- 설정 이름에서 내부 코드명을 뺀다, 사람이 읽어 아는 말로 부른다
- 도움말을 화면 말로 되돌린다, 개발 기록과 문서 문체를 화면에 안 쓴다
- 모델 고르기가 다른 모달과 같은 꼴이다, 자작한 창을 안 쓴다
- 같은 위반이 다시 들어오지 못하게 가드로 막는다

## 범위 밖
- 설정 항목 자체를 줄이거나 합치는 일 (말과 꼴만 고침)
- 3문항 초기 설정 화면
- KIS 조회 실패 진단
- 트레이딩 밖 화면의 문구

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 설정 이름에 내부 코드명이 0개다 (Jev · SR-nn · SG-nn · ATR)
- 도움말에 날짜·「실측」·전각 대시가 0개다
- 도움말이 한 문장이고 길이 상한 안에 있다
- 모델 고르기가 다른 모달과 같은 골격을 쓰고 단추가 겹치지 않는다
- 화면에 쓰는 말이 용어집을 지난다
- 위 넷을 가드가 센다, 일부러 되돌려 실패를 확인한다

## 참조
- .claude/heavy/CEO.md §0-2 말의 축 — 화면에 한글 문자열을 직접 적지 않는다, 없는 말은 lib/terms 에 먼저
- LOOP.md 6절 문서 산출물 문체는 마크다운 규정이고 화면 문구가 아니다
- apps/web/lib/trading/settings/registry.ts — 92개 중 라벨 24개에 내부 코드명, 도움말 6개에 전각 대시, 3개에 개발 기록, 13개가 60자 초과
- 사용자 지적 2026-09-27 「모델을 고르라고 해서 골랐더니 그게 왜 jev 모델이야」
- 사용자 지적 2026-09-27 「시스템 용어로 쓰라니깐 또 설명식으로 다 써져 있어」
- 사용자 지적 2026-09-27 「디자인 미쳤어?」

## 항목

### I01 설정 이름을 사람이 아는 말로 바꾼다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/settings/registry.ts, apps/web/lib/trading/settings/copy.test.ts (신규), apps/web/lib/trading/settings/registry.test.ts, apps/web/package.json
감사 기준:
- 라벨에 Jev · SR-nn · SG-nn · ATR 이 0개다 (가드가 셈)
- 명세의 규칙 번호는 source 에 남아 추적이 끊기지 않는다
- 같은 뜻의 라벨이 두 개가 아니다 (이름이 겹치면 어느 것을 고칠지 모른다)
- 가드를 일부러 깨뜨려 실패를 확인한다 (S6)
- 보안: 해당 없음 — 화면 문자열만 바뀌고 표·창구·외부 입력을 안 건드림
의존: 없음

### I02 도움말을 화면 말로 되돌린다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/settings/registry.ts, apps/web/lib/trading/settings/copy.test.ts
감사 기준:
- 도움말에 날짜·「실측」·전각 대시가 0개다
- 도움말이 한 문장이고 60자 안이다
- 금지어(용어집 BANNED_TERMS)가 0개다
- 가드를 일부러 깨뜨려 실패를 확인한다 (S6)
- 보안: 해당 없음 — 화면 문자열만 바뀜
의존: I01

### I03 모든 칸에 고를 것을 준다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/settings/presets.ts (신규), apps/web/lib/trading/settings/presets.test.ts (신규), apps/web/lib/trading/settings/registry.ts, apps/web/app/(trading)/trading/settings/SettingsForm.tsx, apps/web/app/(trading)/trading/settings/SettingsForm.module.css (신규), apps/web/app/(trading)/trading/settings/ModelPickField.tsx, apps/web/app/(trading)/trading/settings/ModelPickField.module.css, apps/web/lib/trading/settings/model-pick.ts, apps/web/lib/trading/settings/model-pick.test.ts, apps/web/lib/terms/action.ts, apps/web/lib/terms/index.ts, apps/web/package.json
감사 기준:
- 숫자 칸마다 고를 것 셋과 슬라이더가 붙고, 값은 최솟값과 최댓값 안에 있다
- 프리셋 값이 기본값에서 계산된다, 지어낸 숫자가 아니다 (기본에만 권장 표시)
- 빈칸에 글자를 적던 칸 다섯이 고르기나 켬끔으로 바뀐다
- 모델 고르기가 다른 모달과 같은 골격이고 단추가 겹치지 않는다
- 화면에 새 한글 문자열을 직접 안 적는다
- 보안: 해당 없음, 그리는 꼴과 순수 계산만 바뀌고 창구가 안 바뀜
의존: 없음

### I03a 자주 보는 것을 앞으로 꺼낸다
상태: 통과
모드: 경량
범위: apps/web/lib/trading/settings/daily.ts (신규), apps/web/lib/trading/settings/daily.test.ts (신규), apps/web/app/(trading)/trading/settings/page.tsx, apps/web/app/(trading)/trading/settings/SettingsGroups.tsx, apps/web/lib/terms/entity.ts, apps/web/lib/policy/trading-settings-surface.test.ts, apps/web/package.json
감사 기준:
- 매일 보는 값 여덟이 맨 위에 서고 나머지는 접힌 채로 남는다
- 접은 묶음 머리에 기본값과 다른 개수가 뜬다, 접었다고 사실이 사라지지 않는다
- 여덟에 든 값이 아래 묶음에서 사라지지 않는다, 한 값이 두 곳에서 보여도 같은 값이다
- 목록이 레지스트리에서 나온다, 화면이 키를 손으로 적지 않는다
- 보안: 해당 없음
의존: I03

### I03b 세 문항으로 시작한다
상태: 통과
모드: 중량
범위: apps/web/lib/trading/settings/onboarding.ts (신규), apps/web/lib/trading/settings/onboarding.test.ts (신규), apps/web/lib/trading/settings/start-labels.ts (신규), apps/web/app/(trading)/trading/settings/StartPanel.tsx (신규), apps/web/app/(trading)/trading/settings/StartPanel.module.css (신규), apps/web/app/(trading)/trading/settings/actions.ts, apps/web/app/(trading)/trading/settings/page.tsx, apps/web/package.json
감사 기준:
- 세 문항에 답하면 채울 값 목록이 나오고 저장 전에 보여 준다
- 채우는 값에 AI 금지 목록 키가 섞이면 그 줄은 사람 확인 표시가 붙는다 (사람이 답한 것과 AI 제안을 가른다)
- 한 번의 위험을 돈으로 환산해 한도 안인지 같은 화면에서 말한다 (M6)
- 저장이 기존 창구를 지나 다음 거래일부터 듣는다 (M7)
- 손실 한도를 올리는 답에는 무엇을 잃을 수 있는지 보이고 확인을 받는다
- 보안: 창구가 소유자 확인을 먼저 지나고, 채우는 값이 레지스트리에 등재된 키뿐이다, 일부러 금지 키를 넣어 막히는 것을 확인 (S2·S6)
의존: I03a

### I04 종합 감사와 업데이트 내역
상태: 통과
모드: 경량
범위: .loop/PLAN.md, apps/web/lib/changelog/entries.ts, package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 네 개 전부 통과 (결과를 PLAN.md 에 적음)
- LOOP.md 7절 「기계가 세는 것」 다섯 줄을 실제로 실행하고 결과가 전부 0
- git diff a3a26602..HEAD --stat 에 범위 밖 변경·비밀 없음
- 사용자 체감 변경이 entries.ts 맨 위 이번 버전 블록에 적힌다
- 보안: 위 다섯 줄이 이 항목의 보안 감사 기준임
의존: I01, I02, I03, I03a, I03b

## 종합 감사

실행 2026-09-27, 시작 커밋 a3a26602 기준

### 1 검사 넷

| 명령 | 결과 |
|---|---|
| pnpm tsc --noEmit | 통과 |
| pnpm lint | 통과 |
| pnpm test | 통과, 시험 8,048개 전부, 실패 0 |
| NEXT_DIST_DIR=.next-p0078 pnpm build | 통과, /trading/settings 16.4kB |

### 2 완료 정의 대조

| 완료 정의 | 확인 |
|---|---|
| 이름에 내부 코드명 0 | copy.test.ts 가 Jev·SR-nn·SG-nn·ATR·KIS 를 셈 |
| 도움말에 날짜·실측·전각 대시 0 | 같은 가드 |
| 도움말이 한 문장, 60자 안, 존댓말 | 같은 가드 |
| 모든 숫자 칸에 고를 것 셋과 슬라이더 | presets.test.ts 가 범위·정수·중복·칸 수를 셈 |
| 빈칸 글자 다섯이 고르기로 | 글자 칸 12에서 7로 |
| 모달이 다른 모달과 같은 골격 | 머리·본문·바닥, 인라인 꼴 0개 |
| 매일 보는 것이 앞에, 묶음에서 안 사라짐 | daily.test.ts 가 빼는 코드를 셈 |
| 접힌 머리에 바꾼 개수 | 같은 가드 |
| 세 문항이 규정을 안 비켜 감 | onboarding.test.ts 12단정 |
| 화면에 한글을 직접 안 적음 | 화면 둘에 한글 리터럴 0개 |

### 3 보안, 기계가 세는 다섯 줄

2026-09-27 운영 DB 실행, 다섯 줄 전부 0.
이번 판의 보안 판정은 둘이고 가드로 잠갔다
- S2 새 창구 둘(미리보기·채우기)이 소유자 확인을 먼저 지난다
- §15.3 금지 키에 사람이 답했다는 표가 붙고, 저장은 답에서 다시 계산한 값만 쓴다

### 4 전체 diff

git diff a3a26602..HEAD --stat, 32파일 1,704추가 179삭제. 범위 밖 변경 없음, 비밀 없음

### 5 항목 대 결과 대조

| 항목 | 커밋 |
|---|---|
| I01 이름 | 385d44dc |
| I02 도움말 | ae1e5c9c |
| I03 고를 것 | 9e3db48d |
| I03a 매일 보는 것 | 5cee62f4 |
| I03b 세 문항 | 6f70910d |

### 6 발견 사항

- 규정은 이미 있었다. CEO.md §0-2 는 화면 문구 규정이고 LOOP.md 6절 개조식은 마크다운 규정인데, 그 문서 문체가 화면 92개에 그대로 적혀 있었다
- 내가 만든 가드가 위반의 원인이었다. P0076 에서 「도움말에 실측 날짜가 있어야 한다」를 가드로 걸었고 그것이 화면에 개발 기록을 강제했다
- 가드 둘이 글자를 세고 있었다. 게이트 번호를 이름에서 찾던 것과 조수사를 글자로 찾던 것. 둘 다 그 상태를 굳혀 주고 있어 함께 고쳤다
- 프리셋 숫자를 안 지어냈다. 가운데만 명세 §19 기본값이라 권장이 붙고 양쪽은 방향만 말한다. 보고에서 남긴 물음 그대로다
- 슬라이더 칸 수가 처음에 999칸·990칸이었다. 200 아래로 잡았다
- 배선 가드가 안 불리는 내보내기를 또 잡았다

## 변경 이력
- v0.1.0 (2026-09-27) 최초 작성 (ins_0135)
- v0.2.3 (2026-09-27) I03b 범위에 라벨 표와 모듈 CSS 추가 — 화면에 한글과 꼴을 직접 안 적는다는 규칙을 지키려면 둘이 먼저 있어야 한다 (audit:I03b)
- v0.2.2 (2026-09-27) I03a 범위에 용어집 개체와 화면 가드 추가 — 개수 표기를 화면이 짓지 않게 조수사를 용어집으로 옮겼고, 그 글자를 그대로 찾던 가드가 화면이 조수사를 고르는 상태를 굳혀 주고 있었다 (audit:I03a)
- v0.2.1 (2026-09-27) I03 범위에 용어집 두 파일과 모달 라벨 추가 — 화면에 한글을 직접 안 적으려면 새 말이 lib/terms 에 먼저 있어야 한다는 것이 CEO.md §0-2 규칙이다 (audit:I03)
- v0.2.0 (2026-09-27) 사용자 개입 — 설정 화면을 다시 기획해 보고했고(기획 보고 2026-09-27) 「구현해 멈추지마」로 승인받았다. I03 을 모달 꼴에서 「모든 칸에 고를 것」으로 넓히고 I03a 자주 보는 것, I03b 세 문항을 뒤에 넣었다. 보고에서 남긴 물음 둘은 내가 적은 제안대로 간다: 보수·적극 프리셋 숫자는 안 지어내고 기본에만 권장을 붙이며, 세 문항이 손실 한도를 올릴 때는 잃을 수 있는 금액을 보이고 확인을 받는다 (iv_0120)
- v0.1.1 (2026-09-27) I01·I02 를 한 판에 함께 함 — 이름과 도움말이 한 블록이라 따로 고치면 두 번 훑게 된다. 범위에 registry.test.ts 추가: 게이트 번호를 이름에서 근거로 옮겼고, 도움말에 실측 날짜를 요구하던 내 가드가 바로 이 위반의 원인이라 「고를 것이 있는가」로 바꿨다 (audit:I01)
- v0.1.1 (2026-09-27) I01·I02 를 한 판에 함께 하고 범위에 registry.test.ts 추가 — 게이트 번호를 이름에서 근거로 옮겼고, 도움말에 실측 날짜를 요구하던 가드가 이 위반의 원인이라 바꿨다 (audit:I01)
- v0.2.0 (2026-09-27) 사용자 개입으로 범위 확대 — 설정 재기획을 승인받아 I03 을 모든 칸에 고를 것으로 넓히고 자주 보는 것·세 문항을 뒤에 넣었다 (iv_0120)
- v0.2.1 (2026-09-27) I03 범위에 용어집 두 파일과 모달 라벨 추가 — 새 말은 lib/terms 에 먼저 올린다 (audit:I03)
- v0.2.2 (2026-09-27) I03a 범위에 용어집 개체와 화면 가드 추가 — 조수사를 용어집으로 옮겼고 글자를 그대로 찾던 가드를 고쳤다 (audit:I03a)
- v0.2.3 (2026-09-27) I03b 범위에 라벨 표와 모듈 CSS 추가 (audit:I03b)
