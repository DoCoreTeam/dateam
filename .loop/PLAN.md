# PLAN newAX: 설정 화면의 말과 꼴을 규정대로 되돌린다
플랜 ID: P0078
플랜 버전: v0.1.1
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

### I03 모델 고르기가 다른 모달과 같은 꼴이다
상태: 대기
모드: 경량
범위: apps/web/app/(trading)/trading/settings/ModelPickField.tsx, apps/web/app/(trading)/trading/settings/ModelPickField.module.css, apps/web/app/(trading)/trading/settings/SettingsForm.tsx, apps/web/lib/trading/settings/model-pick.test.ts
감사 기준:
- 모달 골격이 기존 모달과 같다 (머리·본문·바닥, 닫기 자리)
- 설정 행에서 단추와 글자가 겹치지 않고 저장 안내가 줄 밖으로 안 나간다
- 공급자 탭이 고른 것과 안 고른 것을 눈으로 가른다
- 화면에 새 한글 문자열을 직접 안 적는다
- 보안: 해당 없음 — 그리는 꼴만 바뀌고 창구가 안 바뀜
의존: 없음

### I04 종합 감사와 업데이트 내역
상태: 대기
모드: 경량
범위: .loop/PLAN.md, apps/web/lib/changelog/entries.ts, package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 네 개 전부 통과 (결과를 PLAN.md 에 적음)
- LOOP.md 7절 「기계가 세는 것」 다섯 줄을 실제로 실행하고 결과가 전부 0
- git diff a3a26602..HEAD --stat 에 범위 밖 변경·비밀 없음
- 사용자 체감 변경이 entries.ts 맨 위 이번 버전 블록에 적힌다
- 보안: 위 다섯 줄이 이 항목의 보안 감사 기준임
의존: I01, I02, I03

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-27) 최초 작성 (ins_0135)
- v0.1.1 (2026-09-27) I01·I02 를 한 판에 함께 함 — 이름과 도움말이 한 블록이라 따로 고치면 두 번 훑게 된다. 범위에 registry.test.ts 추가: 게이트 번호를 이름에서 근거로 옮겼고, 도움말에 실측 날짜를 요구하던 내 가드가 바로 이 위반의 원인이라 「고를 것이 있는가」로 바꿨다 (audit:I01)
- v0.1.1 (2026-09-27) I01·I02 를 한 판에 함께 하고 범위에 registry.test.ts 추가 — 게이트 번호를 이름에서 근거로 옮겼고, 도움말에 실측 날짜를 요구하던 가드가 이 위반의 원인이라 바꿨다 (audit:I01)
