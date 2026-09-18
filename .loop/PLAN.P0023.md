# PLAN newAX: 행 작업 메뉴가 화면 밖으로 나가지 않는다
플랜 ID: P0023
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0025
목표 버전: v0.10.141
작성: 2026-09-19
시작 커밋: f85d3a84

## 목표
- 목록 맨 아래 행에서 더보기를 눌러도 메뉴가 화면 밖으로 잘리지 않고 위로 열림
- 메뉴 안에서 삭제 확인이 펼쳐져 길어져도 다시 자리를 잡음
- 한 쪽뿐인 목록에서도 끝이 어디인지 알 수 있음 (지금은 아무 표시 없이 끝남)

## 범위 밖
- 메뉴를 화면 최상위로 띄우는 방식(portal)으로 바꾸기
- 목록 부품의 다른 배치 규칙
- 커서형 목록의 더 보기 흐름

## 완료 정의
- pnpm tsc --noEmit, pnpm test 통과
- 브라우저 실측: 마지막 행 메뉴의 아래변이 화면 안에 들어옴
- 가드를 일부러 깨면 실패함

## 참조
- apps/web/components/ui/list/RowActions.tsx (목록 전부가 쓰는 공용 부품)
- apps/web/components/ui/list/ListPager.tsx

## 항목

### I01 아래 공간이 없으면 위로 연다
상태: 통과
모드: 경량
범위: apps/web/components/ui/list/RowActions.tsx, apps/web/app/globals.css, apps/web/e2e/row-actions-flip.spec.ts (신규)
감사 기준:
- 마지막 행에서 더보기를 열면 메뉴 아래변이 화면 높이 안에 들어옴 (좌표 실측)
- 위쪽 행에서는 그대로 아래로 열림
- 메뉴 안에서 삭제 확인이 펼쳐져 길어져도 다시 자리를 잡음
- 가드를 일부러 깨면 실패함
의존: 없음

### I02 한 쪽뿐이어도 목록 끝을 알린다
상태: 통과
모드: 경량
범위: apps/web/components/ui/list/ListPager.tsx
감사 기준:
- 한 쪽뿐인 목록 끝에 전체 건수가 한 줄로 보임
- 여러 쪽인 목록은 지금처럼 페이지 단추가 보임
- 0건이면 아무것도 안 그림 (빈 상태가 이미 말하고 있음)
의존: 없음

### I03 판 번호
상태: 대기
모드: 경량
범위: package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- 다섯 파일의 판 번호가 같고 커밋 직전 다시 계산한 다음 패치임
- node --test lib/policy/policy-sync.test.ts lib/policy/version-rule.test.ts 통과
의존: I02

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-19) 최초 작성 (ins_0025)
