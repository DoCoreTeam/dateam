# PLAN newAX: GPU 관리 화면의 깨진 디자인과 읽는 흐름을 바로잡는다
플랜 ID: P0178
플랜 버전: v0.1.2
상태: 진행중
지시: ins_0458
목표 버전: v0.11.103
푸시: 즉시
작성: 2026-11-04
시작 커밋: fb1e8cd9

## 목표
- /pricing/gpu 표의 선, 배경, 단추 테두리가 다시 그려진다 (없는 CSS 토큰 넷이 원인)
- 화면이 무엇이고 어떻게 읽는지 위에서 말하고, 값 있는 모델만 먼저 보이며, 칸 안에서 금액이 가장 크게 보인다
- 420px 에서는 모델별 카드로 보이고 가로 스크롤이 없다

## 범위 밖
- 계산, 저장, 창구, 데이터 자체는 바꾸지 않음 (업체명 표기 통일과 약정 표기 정리는 표시와 읽기 정규화만)
- 문의하기 단추: 이 화면에서 이어질 문의 기능이 없음, 새 기능이라 이번에 안 만들고 「자세히」와 「시세 추가」로 다음 행동을 잇는다
- 강조색 청록: 사이트 전체 테마 토큰(--brand)을 따름, 한 화면만 색을 바꾸면 사이드바와 갈림

## 완료 정의
- pnpm typecheck, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 lib/gpu/board-copy.ts 와 lib/gpu/terms.ts 에서 가져옴
- 1280px 와 420px 실브라우저 캡처에서 가로 스크롤 0, 줄바꿈 깨짐 없음

## 참조
- LOOP.md 9절 U-N F-N, apps/web/app/globals.css 토큰

## 항목

### I01 없는 CSS 토큰을 고치고 다시 안 생기게 가드를 둔다
상태: 통과
모드: 경량
범위: apps/web/app/globals.css, apps/web/lib/ui/css-vars-defined.test.ts (신규), apps/web/package.json
감사 기준:
- 보안: 해당 없음 (CSS 와 시험만, 데이터 창구 입력 없음)
- 새 가드가 CSS 모듈 전체에서 정의 안 된 var(--x) (기본값 없는 것) 를 0건으로 단정하고, board.module.css 를 고치기 전 판에서 실패함을 확인
- pnpm test 에 등재되어 실제로 돎
의존: 없음

### I02 약정 표기와 업체명 표기를 정리한다
상태: 통과
모드: 경량
범위: apps/web/lib/gpu/term.ts, apps/web/lib/gpu/term.test.ts, apps/web/lib/gpu/board.ts, apps/web/lib/gpu/board.test.ts
감사 기준:
- 보안: 해당 없음 (순수 함수, 저장 경로 변경 없음)
- 12-month term 은 12개월, one-year contract 는 1년, 30 days 는 30일로 읽힌다 (term.test.ts)
- ソフトバンク 와 SoftBank, konst tech 와 Konsttech 가 한 이름으로 보인다 (board.test.ts)
의존: 없음

### I03 화면 구조: 안내, 읽는 법, 칸 위계, 값 있는 모델 먼저, 고정 머리줄, 줄 단추, 모바일 카드
상태: 통과
모드: 경량
범위: apps/web/app/(member)/pricing/gpu/board/GpuBoardClient.tsx, apps/web/app/(member)/pricing/gpu/board/board.module.css, apps/web/lib/gpu/board-copy.ts, apps/web/app/(member)/pricing/gpu/board/EntryPanel.tsx
감사 기준:
- 보안: 해당 없음 (화면 배치만, 창구와 권한 판정 변경 없음)
- 1280px: 가로 스크롤 0, 머리줄이 스크롤해도 위에 붙음, 기본은 값 있는 모델만, 「전체 보기」로 값 없는 줄이 옅게 펼쳐짐
- 420px: 모델별 카드, 가로 스크롤 0, 누르는 곳 44px 이상
- 값 없는 줄의 「시세 추가」가 그 모델이 채워진 입력 창을 연다 (실브라우저)
의존: I01, I02

### I04 업데이트 내역과 실브라우저 기록
상태: 통과
모드: 경량
범위: apps/web/lib/changelog/entries.ts
감사 기준:
- 보안: 해당 없음 (문구만)
- 1280px 와 420px 캡처 결과를 종합 감사에 적음
의존: I03

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-11-04) 최초 작성 (ins_0458)
- v0.1.1 (2026-11-04) I01 범위를 globals.css 로, 같은 결함이 CSS 모듈 열여섯 곳이라 토큰 별칭 한 곳에서 고침
- v0.1.2 (2026-11-04) I01 범위 globals.css, 같은 결함 16곳 (audit:I01)
